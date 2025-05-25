const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const PaymentService = require('../services/payment.service');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validateRequest');

// Create payment intent for an order
router.post(
  '/create-intent/:orderId',
  authenticate,
  [
    param('orderId').isUUID().withMessage('Invalid order ID'),
    validateRequest
  ],
  async (req, res, next) => {
    try {
      const { orderId } = req.params;
      const userId = req.user.id;

      const paymentIntent = await PaymentService.createPaymentIntent(orderId, userId);
      res.json(paymentIntent);
    } catch (error) {
      next(error);
    }
  }
);

// Handle Stripe webhooks
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res, next) => {
    try {
      const sig = req.headers['stripe-signature'];
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      await PaymentService.handleWebhook(event);
      res.json({ received: true });
    } catch (error) {
      next(error);
    }
  }
);

// Get payment details
router.get(
  '/:paymentId',
  authenticate,
  [
    param('paymentId').isUUID().withMessage('Invalid payment ID'),
    validateRequest
  ],
  async (req, res, next) => {
    try {
      const { paymentId } = req.params;
      const userId = req.user.id;

      const payment = await PaymentService.getPaymentDetails(paymentId, userId);
      res.json(payment);
    } catch (error) {
      next(error);
    }
  }
);

// Request refund
router.post(
  '/:paymentId/refund',
  authenticate,
  [
    param('paymentId').isUUID().withMessage('Invalid payment ID'),
    body('reason').optional().isString().trim().notEmpty().withMessage('Refund reason must be a non-empty string'),
    validateRequest
  ],
  async (req, res, next) => {
    try {
      const { paymentId } = req.params;
      const userId = req.user.id;
      const { reason } = req.body;

      const refund = await PaymentService.refundPayment(paymentId, userId);
      res.json(refund);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
