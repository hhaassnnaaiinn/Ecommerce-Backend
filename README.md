# E-Commerce Backend API

A scalable e-commerce backend API built with Node.js, Express, and PostgreSQL.

## Tech Stack

- Node.js & Express.js
- PostgreSQL with Sequelize ORM
- JWT Authentication
- Winston Logger
- Jest for Testing

## Project Structure

```
backend/
├── src/
│   ├── config/         # Configuration files
|   |   ├── database.js
│   ├── middleware/     # Custom middleware
│   ├── models/         # Database models
│   ├── routes/         # API routes
│   └── app.js          # Express app setup
```

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=3000
   NODE_ENV=development
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=ecommerce
   DB_USER=your_username
   DB_PASSWORD=your_password
   JWT_SECRET=your_jwt_secret
   # Stripe Configuration
   STRIPE_SECRET_KEY=your_stripe_secret_key
   STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
   STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## API Documentation

### Authentication Endpoints

#### Register User
- **POST** `/api/auth/register`
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }
  ```

#### Login
- **POST** `/api/auth/login`
- **Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```

### Product Endpoints

#### Get All Products
- **GET** `/api/products`
- **Query Parameters:**
  - `page` (default: 1)
  - `limit` (default: 10)
  - `category` (optional)
  - `search` (optional)

#### Get Single Product
- **GET** `/api/products/:id`

#### Create Product (Admin only)
- **POST** `/api/products`
- **Headers:** `Authorization: Bearer <token>`
- **Body:**
  ```json
  {
    "name": "Product Name",
    "description": "Product Description",
    "price": 99.99,
    "category": "Category",
    "stock": 100
  }
  ```

### Order Endpoints

#### Create Order
- **POST** `/api/orders`
- **Headers:** `Authorization: Bearer <token>`
- **Body:**
  ```json
  {
    "items": [
      {
        "productId": 1,
        "quantity": 2
      }
    ],
    "shippingAddress": {
      "street": "123 Main St",
      "city": "City",
      "state": "State",
      "zipCode": "12345"
    }
  }
  ```

#### Get User Orders
- **GET** `/api/orders`
- **Headers:** `Authorization: Bearer <token>`

## Error Handling

The API uses standard HTTP status codes:
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

## Security

- JWT-based authentication
- Password hashing with bcrypt
- Input validation using express-validator
- CORS enabled
- Environment variables for sensitive data

## Testing

Run tests using:
```bash
npm test
``` 
