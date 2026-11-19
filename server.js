
const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD সেট করো");
  process.exit(1);
}

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  }
}));

app.use(express.static(path.join(__dirname, "public")));

let products = [
  { id: 1, name: "VIP 0 Demo", price: 700 },
  { id: 2, name: "VIP 1 Demo", price: 1100 }
];

let orders = [];
let nextId = 3;

function adminOnly(req, res, next) {
  if (req.session.isAdmin) return next();
  res.status(401).json({ error: "Login required" });
}

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }

  res.status(401).json({ error: "Wrong login details" });
});

app.post("/api/admin/logout", adminOnly, (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get("/api/products", (req, res) => {
  res.json(products);
});

app.post("/api/orders", (req, res) => {
  const product = products.find(
    p => p.id === Number(req.body.productId)
  );

  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  const order = {
    id: Date.now(),
    product: product.name,
    status: "Demo Order"
  };

  orders.unshift(order);
  res.json(order);
});

app.get("/api/admin/data", adminOnly, (req, res) => {
  res.json({ products, orders });
});

app.post("/api/admin/products", adminOnly, (req, res) => {
  const { name, price } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Name required" });
  }

  const product = {
    id: nextId++,
    name: String(name),
    price: Math.max(0, Number(price) || 0)
  };

  products.push(product);
  res.json(product);
});

app.delete("/api/admin/products/:id", adminOnly, (req, res) => {
  products = products.filter(
    p => p.id !== Number(req.params.id)
  );

  res.json({ success: true });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.listen(PORT, () => {
  console.log("HECAR Website running on port " + PORT);
});
