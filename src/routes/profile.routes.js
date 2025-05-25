const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/user.model');
const Address = require('../models/address.model');
const Wishlist = require('../models/wishlist.model');
const { Order } = require('../models/order.model');
const { auth } = require('../middleware/auth.middleware');
const sequelize = require('../config/database');

const router = express.Router();

// Get user profile
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching profile' });
  }
});

// Update user profile
router.patch('/', [
  auth,
  body('firstName').optional().isLength({ min: 1, max: 50 }),
  body('lastName').optional().isLength({ min: 1, max: 50 }),
  body('phoneNumber').optional().matches(/^\+?[\d\s-]{10,}$/),
  body('dateOfBirth').optional().isDate(),
  body('profilePicture').optional().isURL(),
  body('preferences').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const allowedUpdates = [
      'firstName', 'lastName', 'phoneNumber', 
      'dateOfBirth', 'profilePicture', 'preferences'
    ];

    const updates = Object.keys(req.body)
      .filter(key => allowedUpdates.includes(key))
      .reduce((obj, key) => {
        obj[key] = req.body[key];
        return obj;
      }, {});

    const user = await User.findByPk(req.user.id);
    await user.update(updates);

    res.json(user.getPublicProfile());
  } catch (error) {
    res.status(500).json({ error: 'Error updating profile' });
  }
});

// Get user addresses
router.get('/addresses', auth, async (req, res) => {
  try {
    const addresses = await Address.findAll({
      where: { userId: req.user.id },
      order: [['isDefault', 'DESC'], ['createdAt', 'ASC']]
    });
    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching addresses' });
  }
});

// Add new address
router.post('/addresses', [
  auth,
  body('label').isLength({ min: 1, max: 50 }),
  body('street').notEmpty(),
  body('city').notEmpty(),
  body('state').notEmpty(),
  body('zipCode').notEmpty(),
  body('country').optional().isString(),
  body('phoneNumber').optional().matches(/^\+?[\d\s-]{10,}$/),
  body('isDefault').optional().isBoolean()
], async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { isDefault, ...addressData } = req.body;

    // If this is set as default, unset any existing default
    if (isDefault) {
      await Address.update(
        { isDefault: false },
        {
          where: { userId: req.user.id },
          transaction
        }
      );
    }

    const address = await Address.create({
      ...addressData,
      userId: req.user.id,
      isDefault: isDefault || false
    }, { transaction });

    await transaction.commit();
    res.status(201).json(address);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error adding address' });
  }
});

// Update address
router.patch('/addresses/:id', [
  auth,
  body('label').optional().isLength({ min: 1, max: 50 }),
  body('street').optional().notEmpty(),
  body('city').optional().notEmpty(),
  body('state').optional().notEmpty(),
  body('zipCode').optional().notEmpty(),
  body('country').optional().isString(),
  body('phoneNumber').optional().matches(/^\+?[\d\s-]{10,}$/),
  body('isDefault').optional().isBoolean()
], async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const address = await Address.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      transaction
    });

    if (!address) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Address not found' });
    }

    const { isDefault, ...updates } = req.body;

    // If setting as default, unset any existing default
    if (isDefault) {
      await Address.update(
        { isDefault: false },
        {
          where: {
            userId: req.user.id,
            id: { [sequelize.Op.ne]: address.id }
          },
          transaction
        }
      );
    }

    await address.update({
      ...updates,
      isDefault: isDefault !== undefined ? isDefault : address.isDefault
    }, { transaction });

    await transaction.commit();
    res.json(address);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error updating address' });
  }
});

// Delete address
router.delete('/addresses/:id', auth, async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const address = await Address.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      transaction
    });

    if (!address) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Address not found' });
    }

    await address.destroy({ transaction });

    // If deleted address was default, set another address as default
    if (address.isDefault) {
      const newDefault = await Address.findOne({
        where: { userId: req.user.id },
        order: [['createdAt', 'ASC']],
        transaction
      });

      if (newDefault) {
        await newDefault.update({ isDefault: true }, { transaction });
      }
    }

    await transaction.commit();
    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error deleting address' });
  }
});

// Get wishlist
router.get('/wishlist', auth, async (req, res) => {
  try {
    const wishlist = await Wishlist.findAll({
      where: { userId: req.user.id },
      include: [Product],
      order: [['addedAt', 'DESC']]
    });
    res.json(wishlist);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching wishlist' });
  }
});

// Add to wishlist
router.post('/wishlist/:productId', auth, async (req, res) => {
  try {
    const wishlistItem = await Wishlist.create({
      userId: req.user.id,
      productId: req.params.productId
    });

    const wishlistWithProduct = await Wishlist.findByPk(wishlistItem.id, {
      include: [Product]
    });

    res.status(201).json(wishlistWithProduct);
  } catch (error) {
    if (error.message === 'Product already in wishlist') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Error adding to wishlist' });
  }
});

// Remove from wishlist
router.delete('/wishlist/:productId', auth, async (req, res) => {
  try {
    const deleted = await Wishlist.destroy({
      where: {
        userId: req.user.id,
        productId: req.params.productId
      }
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Product not in wishlist' });
    }

    res.json({ message: 'Product removed from wishlist' });
  } catch (error) {
    res.status(500).json({ error: 'Error removing from wishlist' });
  }
});

// Get order history
router.get('/orders', auth, async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { userId: req.user.id },
      include: [{
        model: OrderItem,
        include: [Product]
      }],
      order: [['createdAt', 'DESC']]
    });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching order history' });
  }
});

// Update notification preferences
router.patch('/preferences', [
  auth,
  body('newsletterSubscription').optional().isBoolean(),
  body('emailNotifications').optional().isBoolean(),
  body('smsNotifications').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const user = await User.findByPk(req.user.id);
    const currentPreferences = user.preferences || {};
    
    await user.update({
      preferences: {
        ...currentPreferences,
        ...req.body
      }
    });

    res.json(user.preferences);
  } catch (error) {
    res.status(500).json({ error: 'Error updating preferences' });
  }
});

module.exports = router; 