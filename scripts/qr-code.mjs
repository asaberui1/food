/**
 * 生成点餐二维码：node scripts/qr-code.mjs <url> <output.png>
 * 用于把店家的扫码点餐链接做成可扫的图片（浅底深码，方便手机识别）。
 */
import QRCode from "qrcode";

const [url, out = "order-qr.png"] = process.argv.slice(2);
if (!url) {
  console.error("用法：node scripts/qr-code.mjs <url> <output.png>");
  process.exit(1);
}

await QRCode.toFile(out, url, {
  width: 720,
  margin: 2,
  errorCorrectionLevel: "M",
  color: { dark: "#17130fff", light: "#fbf0dcff" },
});
console.log(`已生成 ${out}`);
