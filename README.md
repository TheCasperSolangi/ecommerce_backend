# 🛒 OpenCommerce

**OpenCommerce** is a powerful, open source eCommerce backend platform built with **Node.js**, **Express**, and **MongoDB**. Designed for developers who want full control over their store infrastructure — from product catalogs and multi-vendor support to payments, shipping, and customer support ticketing.

---

## ✨ Features

- 🔐 **Authentication & Authorization** — Email/password, passwordless (OTP via SMS/email), and social login (Google & Facebook) with JWT-based sessions
- 👤 **User & Vendor Management** — Customer profiles, address books, role-based access control, and vendor accounts
- 📦 **Product Catalog** — Rich product listings with categories, brands, variants, media uploads, and full-text search support
- 🛍️ **Shopping Cart** — Persistent cart management per user
- 🏷️ **Coupons & Discounts** — Flexible coupon engine with usage limits, expiry, and discount rules
- 📋 **Order Management** — Full order lifecycle from placement to fulfillment, with status tracking
- 💳 **Payments** — Integrated **Stripe** and **PayPal** payment gateways with transaction records
- 🚚 **Shipping** — Configurable shipping methods and rates
- 🏭 **Warehouse / Inventory** — Multi-warehouse inventory tracking
- 📊 **Banners & Marketing** — CMS-style banner management and marketing campaign support
- 🧾 **Invoices** — PDF invoice generation via PDFKit
- 🎫 **Support Ticketing** — Built-in customer support ticket system
- ⚙️ **Platform Settings** — Global store configuration via a settings API
- 📨 **Transactional Emails** — Email delivery powered by **Resend**
- 📱 **SMS Notifications** — SMS support via **Twilio**
- 🔒 **Security** — Rate limiting, XSS protection, HTTP security headers via Helmet, input validation with express-validator

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Database | MongoDB + Mongoose |
| Auth | JWT, Google OAuth, Facebook (Firebase Admin) |
| Payments | Stripe, PayPal |
| Email | Resend |
| SMS | Twilio |
| File Uploads | Multer |
| PDF Generation | PDFKit |
| Security | Helmet, express-rate-limit, xss-clean |
| Dev Tooling | Nodemon |

---

## 📁 Project Structure

```
backend/
├── server.js               # Entry point
├── storage.js              # File/storage utilities
├── src/
│   ├── app.js              # Express app setup & middleware
│   ├── config/             # Database connection & environment config
│   ├── controllers/        # Route handler logic
│   ├── middleware/         # Auth, error handling, upload middleware
│   ├── models/             # Mongoose data models
│   │   ├── User.js
│   │   ├── Products.js
│   │   ├── Category.js
│   │   ├── Brand.js
│   │   ├── Cart.js
│   │   ├── Order.js
│   │   ├── Coupon.js
│   │   ├── Transactions.js
│   │   ├── Warehouse.js
│   │   ├── Address.js
│   │   ├── Vendor.js
│   │   ├── shipping.js
│   │   ├── banners.js
│   │   ├── marketing.js
│   │   ├── ticket.js
│   │   └── platformSettings.js
│   ├── routes/             # API route definitions
│   ├── utils/              # Helper utilities (email, SMS, tokens, etc.)
│   └── validators/         # Input validation schemas
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [MongoDB](https://www.mongodb.com/) (local or cloud via MongoDB Atlas)
- A [Stripe](https://stripe.com) account (for payment processing)
- A [PayPal Developer](https://developer.paypal.com) account (optional)
- A [Resend](https://resend.com) account (for transactional emails)
- A [Twilio](https://www.twilio.com) account (for SMS)
- A [Firebase](https://firebase.google.com) project (for social login)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/opencommerce.git
cd opencommerce/backend

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Fill in the values in .env

# 4. Start the development server
npm run dev
```

The API will be available at `http://localhost:6464`.

---

## ⚙️ Environment Variables

Create a `.env` file in the root of the `backend/` directory. Key variables include:

```env
# App
NODE_ENV=development
PORT=6464

# MongoDB
MONGO_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/opencommerce

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id

# Firebase (Social Login)
FIREBASE_PROJECT_ID=your_firebase_project_id

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# PayPal
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret

# Resend (Email)
RESEND_API_KEY=re_...

# Twilio (SMS)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

---

## 📡 API Overview

| Prefix | Resource |
|---|---|
| `/api/auth` | Authentication (register, login, OTP, social) |
| `/api/users` | User profile & management |
| `/api/products` | Product catalog |
| `/api/categories` | Product categories |
| `/api/brands` | Product brands |
| `/api/cart` | Shopping cart |
| `/api/orders` | Order management |
| `/api/coupons` | Coupon / discount codes |
| `/api/payments` | Payment processing (Stripe & PayPal) |
| `/api/transactions` | Transaction history |
| `/api/shipping` | Shipping methods & rates |
| `/api/warehouse` | Warehouse & inventory |
| `/api/addresses` | User address book |
| `/api/banners` | Homepage/marketing banners |
| `/api/marketing` | Marketing campaigns |
| `/api/invoices` | Invoice generation & download |
| `/api/tickets` | Customer support tickets |
| `/api/settings` | Platform-wide settings |

---

## 🧪 Scripts

```bash
npm run dev          # Start development server with hot-reload (nodemon)
npm start            # Start production server
npm run storage      # Run storage utility script
npm run storage:dev  # Run storage utility with hot-reload
```

---

## 🤝 Contributing

Contributions are what make the open source community such an amazing place. Any contributions you make are **greatly appreciated**.

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'feat: add some amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

Please make sure to follow existing code style and add tests where applicable.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

## 🌐 OpenCommerce

> Built for developers. Powered by the community. Open forever.
