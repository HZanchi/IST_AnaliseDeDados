const base = `http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3000}`;

try {
  const res = await fetch(`${base}/health`);
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok || !body.ok) {
    console.error(`\nhealth check FAILED (HTTP ${res.status})`);
    process.exit(1);
  }
  console.log(`\nhealth check OK — ${base}`);
} catch (err) {
  console.error(`health check FAILED — ${base}: ${err.message}`);
  process.exit(1);
}
