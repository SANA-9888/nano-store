// Headless UI verification server for the storefront changes.
// Serves the real storefront page with mocked /api endpoints.
import { createServer } from "node:http";
import storefrontHTML from "../src/storefront.js";

const now = Date.now();

const bootstrap = {
  settings: {
    store_name: "فروشگاه تست",
    tagline: "تست",
    brand_color: "#1f2937",
    category_active_bg: "",
    category_active_color: "",
    default_theme: "light",
    theme_switch_enabled: true,
    slider_enabled: false,
    categories_enabled: true,
    search_enabled: true,
    sorting_enabled: true,
    cart_enabled: true,
    orders_enabled: true,
    order_notes_enabled: true,
    discounts_enabled: true,
    payment_contact_enabled: true,
    payment_card_enabled: true,
    payment_gateway_enabled: true,
    blog_enabled: true,
    faq_enabled: true,
    contact_enabled: true,
    contact_links: [],
    default_sort: "pop"
  },
  categories: [
    { id: "cat1", name: "همه‌فروشی", image_id: null, position: 0 },
    { id: "cat2", name: "کیف", image_id: null, position: 1 }
  ],
  slides: [],
  posts: [
    { id: "p1", title: "نوشته اول مجله", image_id: "img1", created_at: now },
    { id: "p2", title: "نوشته دوم", image_id: null, created_at: now - 1000 }
  ],
  faqs: [],
  cards: [],
  users_module: true
};

const products = {
  products: [
    {
      id: "prod1", name: "کیف چرمی", description: "", category_id: "cat2",
      price: 500000, stock: 3, inventory_mode: "simple", sales_count: 7,
      created_at: now, primary_image: null
    }
  ],
  total: 1, page: 1, pages: 1
};

const postDetail = {
  post: { id: "p1", title: "نوشته اول مجله", body: "متن کامل نوشته اول از سرور.", image_id: "img1", created_at: now }
};

const requests = [];

const server = createServer((request, response) => {
  const url = new URL(request.url, "https://shop.example.com");
  requests.push(url.pathname + (url.search || ""));

  const json = (data) => {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(data));
  };

  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(storefrontHTML);
    return;
  }

  if (url.pathname === "/api/bootstrap") return json(bootstrap);
  if (url.pathname === "/api/products") {
    return json({ ...products, echoedCats: url.searchParams.get("cats") || "" });
  }
  if (url.pathname.startsWith("/api/post/")) return json(postDetail);
  if (url.pathname.startsWith("/media/")) {
    // 1x1 transparent PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    response.writeHead(200, { "content-type": "image/png" });
    response.end(png);
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end("{}");
});

server.listen(8791, () => console.log("mock storefront on http://localhost:8791"));
