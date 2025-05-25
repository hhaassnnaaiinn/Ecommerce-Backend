const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Payment = require('../models/payment.model');
const { Order } = require('../models/order.model');
const sequelize = require('../config/database');

class PaymentService {
  static async createPaymentIntent(orderId, userId) {
    const transaction = await sequelize.transaction();

    try {
      // Get order details
      const order = await Order.findOne({
        where: {
          id: orderId,
          userId: userId,
          paymentStatus: 'pending'
        },
        transaction
      });

      if (!order) {
        throw new Error('Order not found or already paid');
      }

      // Create payment record
      const payment = await Payment.create({
        orderId,
        userId,
        amount: order.totalAmount,
        currency: 'usd',
        status: 'pending',
        paymentMethod: 'card'
      }, { transaction });

      // Create Stripe PaymentIntent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(order.totalAmount * 100), // Convert to cents
        currency: 'usd',
        metadata: {
          orderId,
          paymentId: payment.id
        }
      });

      // Update payment record with Stripe PaymentIntent ID
      await payment.update({
        paymentIntentId: paymentIntent.id,
        status: 'processing'
      }, { transaction });

      await transaction.commit();

      return {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        paymentId: payment.id
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  static async handleWebhook(event) {
    const transaction = await sequelize.transaction();

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSuccess(event.data.object, transaction);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentFailure(event.data.object, transaction);
          break;

        case 'charge.refunded':
          await this.handleRefund(event.data.object, transaction);
          break;
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  static async handlePaymentSuccess(paymentIntent, transaction) {
    const payment = await Payment.findOne({
      where: { paymentIntentId: paymentIntent.id },
      transaction
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    // Update payment status
    await payment.update({
      status: 'succeeded',
      metadata: {
        ...payment.metadata,
        stripePaymentIntent: paymentIntent
      }
    }, { transaction });

    // Update order status
    await Order.update(
      {
        paymentStatus: 'paid',
        status: 'processing'
      },
      {
        where: { id: payment.orderId },
        transaction
      }
    );
  }

  static async handlePaymentFailure(paymentIntent, transaction) {
    const payment = await Payment.findOne({
      where: { paymentIntentId: paymentIntent.id },
      transaction
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    // Update payment status
    await payment.update({
      status: 'failed',
      errorMessage: paymentIntent.last_payment_error?.message,
      metadata: {
        ...payment.metadata,
        stripePaymentIntent: paymentIntent
      }
    }, { transaction });

    // Update order status
    await Order.update(
      {
        paymentStatus: 'failed'
      },
      {
        where: { id: payment.orderId },
        transaction
      }
    );
  }

  static async handleRefund(charge, transaction) {
    const payment = await Payment.findOne({
      where: { paymentIntentId: charge.payment_intent },
      transaction
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    // Update payment status
    await payment.update({
      status: 'refunded',
      refundId: charge.id,
      metadata: {
        ...payment.metadata,
        stripeRefund: charge
      }
    }, { transaction });

    // Update order status
    await Order.update(
      {
        paymentStatus: 'refunded',
        status: 'cancelled'
      },
      {
        where: { id: payment.orderId },
        transaction
      }
    );
  }

  static async refundPayment(paymentId, userId) {
    const transaction = await sequelize.transaction();

    try {
      const payment = await Payment.findOne({
        where: {
          id: paymentId,
          userId: userId,
          status: 'succeeded'
        },
        include: [Order],
        transaction
      });

      if (!payment) {
        throw new Error('Payment not found or not eligible for refund');
      }

      // Create refund in Stripe
      const refund = await stripe.refunds.create({
        payment_intent: payment.paymentIntentId
      });

      // Update payment status
      await payment.update({
        status: 'refunded',
        refundId: refund.id,
        metadata: {
          ...payment.metadata,
          stripeRefund: refund
        }
      }, { transaction });

      // Update order status
      await payment.Order.update({
        paymentStatus: 'refunded',
        status: 'cancelled'
      }, { transaction });

      await transaction.commit();
      return payment;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  static async getPaymentDetails(paymentId, userId) {
    const payment = await Payment.findOne({
      where: {
        id: paymentId,
        userId: userId
      },
      include: [Order]
    });

    if (!payment) {
      throw new Error('Payment not found');
    }

    return payment;
  }
}

module.exports = PaymentService; 