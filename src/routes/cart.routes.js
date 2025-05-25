const express = require('express');
const { body, validationResult } = require('express-validator');
const { Cart, CartItem } = require('../models/cart.model');
const Product = require('../models/product.model');
const { auth } = require('../middleware/auth.middleware');
const sequelize = require('../config/database');

const router = express.Router();

// Get user's cart
router.get('/', auth, async (req, res) => {
  try {
    let cart = await Cart.findOne({
      where: {
        userId: req.user.id,
        status: 'active'
      },
      include: [{
        model: CartItem,
        include: [Product]
      }]
    });

    if (!cart) {
      cart = await Cart.create({
        userId: req.user.id,
        totalAmount: 0
      });
    }

    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching cart' });
  }
});

// Add item to cart
router.post('/items', [
  auth,
  body('productId').isUUID().withMessage('Invalid product ID'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, quantity } = req.body;

    // Get or create cart
    let [cart] = await Cart.findOrCreate({
      where: {
        userId: req.user.id,
        status: 'active'
      },
      defaults: {
        userId: req.user.id,
        totalAmount: 0
      },
      transaction
    });

    // Check product availability
    const product = await Product.findOne({
      where: {
        id: productId,
        isActive: true
      },
      transaction
    });

    if (!product) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.stock < quantity) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    // Check if item already exists in cart
    let cartItem = await CartItem.findOne({
      where: {
        cartId: cart.id,
        productId
      },
      transaction
    });

    if (cartItem) {
      // Update quantity if item exists
      const newQuantity = cartItem.quantity + quantity;
      if (product.stock < newQuantity) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Insufficient stock for updated quantity' });
      }

      await cartItem.update({
        quantity: newQuantity,
        price: product.price
      }, { transaction });
    } else {
      // Create new cart item
      cartItem = await CartItem.create({
        cartId: cart.id,
        productId,
        quantity,
        price: product.price
      }, { transaction });
    }

    // Update cart total
    const cartItems = await CartItem.findAll({
      where: { cartId: cart.id },
      transaction
    });

    const totalAmount = cartItems.reduce((total, item) => {
      return total + (item.price * item.quantity);
    }, 0);

    await cart.update({ totalAmount }, { transaction });

    await transaction.commit();

    // Fetch updated cart
    const updatedCart = await Cart.findByPk(cart.id, {
      include: [{
        model: CartItem,
        include: [Product]
      }]
    });

    res.json(updatedCart);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error adding item to cart' });
  }
});

// Update cart item quantity
router.patch('/items/:itemId', [
  auth,
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { quantity } = req.body;
    const cartItem = await CartItem.findOne({
      where: {
        id: req.params.itemId
      },
      include: [{
        model: Cart,
        where: {
          userId: req.user.id,
          status: 'active'
        }
      }, {
        model: Product
      }],
      transaction
    });

    if (!cartItem) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Cart item not found' });
    }

    if (cartItem.Product.stock < quantity) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    await cartItem.update({
      quantity,
      price: cartItem.Product.price
    }, { transaction });

    // Update cart total
    const cartItems = await CartItem.findAll({
      where: { cartId: cartItem.cartId },
      transaction
    });

    const totalAmount = cartItems.reduce((total, item) => {
      return total + (item.price * item.quantity);
    }, 0);

    await cartItem.Cart.update({ totalAmount }, { transaction });

    await transaction.commit();

    // Fetch updated cart
    const updatedCart = await Cart.findByPk(cartItem.cartId, {
      include: [{
        model: CartItem,
        include: [Product]
      }]
    });

    res.json(updatedCart);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error updating cart item' });
  }
});

// Remove item from cart
router.delete('/items/:itemId', auth, async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const cartItem = await CartItem.findOne({
      where: {
        id: req.params.itemId
      },
      include: [{
        model: Cart,
        where: {
          userId: req.user.id,
          status: 'active'
        }
      }],
      transaction
    });

    if (!cartItem) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Cart item not found' });
    }

    await cartItem.destroy({ transaction });

    // Update cart total
    const cartItems = await CartItem.findAll({
      where: { cartId: cartItem.cartId },
      transaction
    });

    const totalAmount = cartItems.reduce((total, item) => {
      return total + (item.price * item.quantity);
    }, 0);

    await cartItem.Cart.update({ totalAmount }, { transaction });

    await transaction.commit();

    // Fetch updated cart
    const updatedCart = await Cart.findByPk(cartItem.cartId, {
      include: [{
        model: CartItem,
        include: [Product]
      }]
    });

    res.json(updatedCart);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error removing item from cart' });
  }
});

// Clear cart
router.delete('/', auth, async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const cart = await Cart.findOne({
      where: {
        userId: req.user.id,
        status: 'active'
      },
      transaction
    });

    if (!cart) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Cart not found' });
    }

    await CartItem.destroy({
      where: { cartId: cart.id },
      transaction
    });

    await cart.update({
      totalAmount: 0
    }, { transaction });

    await transaction.commit();

    // Fetch updated cart
    const updatedCart = await Cart.findByPk(cart.id, {
      include: [{
        model: CartItem,
        include: [Product]
      }]
    });

    res.json(updatedCart);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error clearing cart' });
  }
});

module.exports = router; 