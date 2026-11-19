
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  throw new Error("DATABASE_URL and SESSION_SECRET are required");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new PgSession({
    pool,
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(20) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      wallet NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      description TEXT DEFAULT '',
      price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
      image TEXT DEFAULT '',
      category VARCHAR(100) DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      total NUMERIC(12,2) NOT NULL,
      status VARCHAR(30) DEFAULT 'Pending',
      items JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      amount NUMERIC(12,2) NOT NULL,
      type VARCHAR(30) NOT NULL,
      status VARCHAR(30) DEFAULT 'Pending',
      reference VARCHAR(150),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("Database ready");
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Please login first" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({ error: "Admin login required" });
  }
  next();
}

// CUSTOMER REGISTER
app.post("/api/register", async (req, res) => {
  try {
    const { name, phone, password } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (!/^\+?[0-9]{10,15}$/.test(phone)) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (name, phone, password)
       VALUES ($1, $2, $3)
       RETURNING id, name, phone, wallet`,
      [name.trim(), phone, hash]
    );

    req.session.user = result.rows[0];
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Phone number already registered" });
    }
    console.error(error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// CUSTOMER LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { phone, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE phone = $1",
      [phone]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: "Invalid phone or password" });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password || "", user.password);

    if (!valid) {
      return res.status(401).json({ error: "Invalid phone or password" });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      wallet: user.wallet
    };

    res.json({ success: true, user: req.session.user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed" });
  }
});

// CURRENT CUSTOMER
app.get("/api/me", requireLogin, async (req, res) => {
  const result = await pool.query(
    "SELECT id, name, phone, wallet FROM users WHERE id = $1",
    [req.session.user.id]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json(result.rows[0]);
});

// CUSTOMER LOGOUT
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// PRODUCTS
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM products ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Could not load products" });
  }
});

// PLACE ORDER - wallet payment is not enabled until payment rules are added
app.post("/api/orders", requireLogin, async (req, res) => {
  res.status(501).json({
    error: "Checkout is not enabled yet"
  });
});

// ADMIN LOGIN
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;

  if (
    !process.env.ADMIN_USER ||
    !process.env.ADMIN_PASSWORD ||
    username !== process.env.ADMIN_USER ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: "Invalid admin credentials" });
  }

  req.session.admin = true;
  res.json({ success: true });
});

// ADMIN ADD PRODUCT
app.post("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const { name, description, price, image, category, stock } = req.body;

    if (!name || !Number.isFinite(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ error: "Valid name and price required" });
    }

    const result = await pool.query(
      `INSERT INTO products
       (name, description, price, image, category, stock)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        name,
        description || "",
        price,
        image || "",
        category || "",
        Math.max(0, Number(stock) || 0)
      ]
    );

    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: "Could not add product" });
  }
});

// ADMIN VIEW ORDERS
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  const result = await pool.query(`
    SELECT orders.*, users.name, users.phone
    FROM orders
    LEFT JOIN users ON users.id = orders.user_id
    ORDER BY orders.id DESC
  `);

  res.json(result.rows);
});

app.get("/api/admin/data", requireAdmin, async (req, res) => {
  const [users, products, orders] = await Promise.all([
    pool.query("SELECT COUNT(*) FROM users"),
    pool.query("SELECT COUNT(*) FROM products"),
    pool.query("SELECT COUNT(*) FROM orders")
  ]);

  res.json({
    users: Number(users.rows[0].count),
    products: Number(products.rows[0].count),
    orders: Number(orders.rows[0].count)
  });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

setupDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`SHOP server running on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Database startup failed:", error);
    process.exit(1);
  });
