const express = require('express');
const { body, validationResult } = require('express-validator');
const { Order, OrderItem } = require('../models/order.model');
const { Cart, CartItem } = require('../models/cart.model');
const Product = require('../models/product.model');
const { auth, adminAuth } = require('../middleware/auth.middleware');
const sequelize = require('../config/database');
const { Payment } = require('../models/payment.model');

const router = express.Router();

// Create order
router.post('/', [
  auth,
  body('items').isArray().withMessage('Items must be an array'),
  body('items.*.productId').isUUID().withMessage('Invalid product ID'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('shippingAddress').isObject().withMessage('Shipping address is required'),
  body('shippingAddress.street').notEmpty().withMessage('Street is required'),
  body('shippingAddress.city').notEmpty().withMessage('City is required'),
  body('shippingAddress.state').notEmpty().withMessage('State is required'),
  body('shippingAddress.zipCode').notEmpty().withMessage('Zip code is required')
], async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { items, shippingAddress } = req.body;

    // Calculate total and validate products
    let totalAmount = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findOne({
        where: {
          id: item.productId,
          isActive: true
        },
        transaction
      });

      if (!product) {
        await transaction.rollback();
        return res.status(404).json({ error: `Product ${item.productId} not found` });
      }

      if (product.stock < item.quantity) {
        await transaction.rollback();
        return res.status(400).json({ error: `Insufficient stock for product ${product.name}` });
      }

      // Update product stock
      await product.update({
        stock: product.stock - item.quantity
      }, { transaction });

      const itemTotal = product.price * item.quantity;
      totalAmount += itemTotal;

      orderItems.push({
        productId: product.id,
        quantity: item.quantity,
        price: product.price
      });
    }

    // Create order
    const order = await Order.create({
      userId: req.user.id,
      totalAmount,
      shippingAddress,
      status: 'pending',
      paymentStatus: 'pending'
    }, { transaction });

    // Create order items
    await Promise.all(orderItems.map(item =>
      OrderItem.create({
        ...item,
        orderId: order.id
      }, { transaction })
    ));

    await transaction.commit();

    // Fetch complete order with items
    const completeOrder = await Order.findByPk(order.id, {
      include: [{
        model: OrderItem,
        include: [Product]
      }]
    });

    res.status(201).json(completeOrder);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error creating order' });
  }
});

// Get user orders
router.get('/', auth, async (req, res) => {
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
    res.status(500).json({ error: 'Error fetching orders' });
  }
});

// Get single order
router.get('/:id', auth, async (req, res) => {
  try {
    const order = await Order.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: [{
        model: OrderItem,
        include: [Product]
      }]
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching order' });
  }
});

// Update order status (admin only)
router.patch('/:id/status', [
  adminAuth,
  body('status').isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled'])
    .withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const order = await Order.findByPk(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await order.update({ status: req.body.status });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Error updating order status' });
  }
});

// Update payment status (admin only)
router.patch('/:id/payment', [
  adminAuth,
  body('paymentStatus').isIn(['pending', 'paid', 'failed'])
    .withMessage('Invalid payment status')
], async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const order = await Order.findByPk(req.params.id, {
      include: [{
        model: Payment,
        where: {
          paymentMethod: 'card'
        },
        required: false
      }],
      transaction
    });

    if (!order) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }

    // Prevent manual payment status updates for Stripe payments
    if (order.Payments && order.Payments.length > 0) {
      await transaction.rollback();
      return res.status(400).json({ 
        error: 'Cannot manually update payment status for orders with Stripe payments. Use the payment system instead.' 
      });
    }

    await order.update({ paymentStatus: req.body.paymentStatus }, { transaction });
    await transaction.commit();
    res.json(order);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error updating payment status' });
  }
});

// Convert cart to order
router.post('/from-cart', [
  auth,
  body('shippingAddress').isObject().withMessage('Shipping address is required'),
  body('shippingAddress.street').notEmpty().withMessage('Street is required'),
  body('shippingAddress.city').notEmpty().withMessage('City is required'),
  body('shippingAddress.state').notEmpty().withMessage('State is required'),
  body('shippingAddress.zipCode').notEmpty().withMessage('Zip code is required')
], async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { shippingAddress } = req.body;

    // Get user's active cart
    const cart = await Cart.findOne({
      where: {
        userId: req.user.id,
        status: 'active'
      },
      include: [{
        model: CartItem,
        include: [Product]
      }],
      transaction
    });

    if (!cart) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Cart not found' });
    }

    if (cart.CartItems.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Validate stock for all items
    for (const item of cart.CartItems) {
      if (item.Product.stock < item.quantity) {
        await transaction.rollback();
        return res.status(400).json({ 
          error: `Insufficient stock for product ${item.Product.name}` 
        });
      }
    }

    // Create order
    const order = await Order.create({
      userId: req.user.id,
      totalAmount: cart.totalAmount,
      shippingAddress,
      status: 'pending',
      paymentStatus: 'pending'
    }, { transaction });

    // Create order items and update product stock
    await Promise.all(cart.CartItems.map(async (cartItem) => {
      // Create order item
      await OrderItem.create({
        orderId: order.id,
        productId: cartItem.productId,
        quantity: cartItem.quantity,
        price: cartItem.price
      }, { transaction });

      // Update product stock
      await cartItem.Product.update({
        stock: cartItem.Product.stock - cartItem.quantity
      }, { transaction });
    }));

    // Update cart status
    await cart.update({ status: 'converted' }, { transaction });

    await transaction.commit();

    // Fetch complete order with items
    const completeOrder = await Order.findByPk(order.id, {
      include: [{
        model: OrderItem,
        include: [Product]
      }]
    });

    res.status(201).json(completeOrder);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'Error creating order from cart' });
  }
});

module.exports = router; 