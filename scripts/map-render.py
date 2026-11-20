#!/usr/bin/env python3
"""把 OSM 数据渲染成站点配色的矢量地图：python3 scripts/map-render.py

输出 src/assets/map/neighbourhood.svg，由 src/components/ShopMap.astro 内联到页面。

要先拿到数据（一次性，OSM 官方 API 限制在 0.25° 见方、5 万要素以内）：

    curl -o /tmp/osm.xml \
      "https://api.openstreetmap.org/api/0.6/map?bbox=121.4280,31.1180,121.4620,31.1460"

国内直连要挂代理时加 `-x http://127.0.0.1:7890`。
重跑脚本会覆盖 SVG；改了门店或坐标就重跑一次。

坐标来源：门店用百度地图 POI（按店名/门牌查），再用华泾一带 7 个 OSM 地标
（镇政府、派出所、龙湖天街、亚朵、华泾广场、逸夫小学、华泾小学）拟合
BD09MC → WGS84 的偏差，残差约 30 米。
"""
import math
import sys
import xml.etree.ElementTree as ET

OSM = sys.argv[1] if len(sys.argv) > 1 else "/tmp/osm.xml"
OUT = "src/assets/map/neighbourhood.svg"

W = 1200.0
LON0, LON1 = 121.4268, 121.4522
LAT0, LAT1 = 31.1208, 31.1396
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians((LAT0 + LAT1) / 2))
SPAN = (LON1 - LON0) * M_LON
H = W * ((LAT1 - LAT0) * M_LAT) / SPAN
SCALE = W / SPAN  # 每米像素数

CAMPUS = (31.126958, 121.436930)
SHOPS = [
    ("yunxi-jiujia", "云西酒家", 31.123970, 121.442079),
    ("huajing-jiachangcai", "华泾家常菜", 31.123021, 121.439863),
    ("nanjing-tangbaodian", "南京汤包店", 31.123154, 121.440558),
    ("huji-guotie", "胡记锅贴", 31.128805, 121.445465),
    ("suzhou-cangshu-yangrou", "藏书羊肉", 31.128817, 121.445159),
    ("niuboshi-niurou", "牛博士", 31.128812, 121.445042),
    ("longmianwang-hangzhou-xiaochi", "笼面王", 31.128724, 121.443496),
    ("yigou-hundunmian", "一碗勾馄面", 31.128872, 121.449385),
    ("niumaixiang-niuroumian", "牛麦香", 31.127449, 121.430825),
    ("youziyouwei-jiangxixiaochao", "有滋有味", 31.126606, 121.429570),
    ("xibeihong-lamian", "西北红拉面", 31.137956, 121.437454),
]


def px(lat, lon):
    return (lon - LON0) * M_LON * SCALE, (LAT1 - lat) * M_LAT * SCALE


root = ET.parse(OSM).getroot()
nodes = {n.get("id"): (float(n.get("lat")), float(n.get("lon"))) for n in root.findall("node")}
ways = {
    w.get("id"): (
        {t.get("k"): t.get("v") for t in w.findall("tag")},
        [nd.get("ref") for nd in w.findall("nd")],
    )
    for w in root.findall("way")
}


def project(refs):
    pts = [px(*nodes[r]) for r in refs if r in nodes]
    return pts if len(pts) >= 2 else None


def rdp(pts, eps):
    """道格拉斯-普克抽稀，地图 1 像素≈2 米，略掉亚像素级的抖动可以省下大半体积。"""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    idx, dmax = 0, 0.0
    for i in range(1, len(pts) - 1):
        d = abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / norm
        if d > dmax:
            idx, dmax = i, d
    if dmax <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[: idx + 1], eps)[:-1] + rdp(pts[idx:], eps)


def path_of(pts, close=False, eps=1.1):
    if len(pts) > 3:
        pts = rdp(pts, eps)
    d = "M" + "L".join(f"{x:.0f} {y:.0f}" for x, y in pts)
    return d + ("Z" if close else "")


MARGIN = 220


def in_view(pts, m=MARGIN):
    return any(-m <= x <= W + m and -m <= y <= H + m for x, y in pts)


ROAD_ORDER = ["footway", "path", "cycleway", "steps", "service", "residential",
              "unclassified", "pedestrian", "living_street", "tertiary", "secondary",
              "primary", "trunk_link", "motorway_link", "trunk", "motorway"]
ROAD_STYLE = {
    "motorway": (12.0, "#52402b"), "trunk": (10.0, "#52402b"),
    "motorway_link": (7.0, "#433426"), "trunk_link": (7.0, "#433426"),
    "primary": (8.5, "#4c3d2d"), "secondary": (6.8, "#48392b"),
    "tertiary": (5.6, "#4a4031"), "unclassified": (4.2, "#3e3529"),
    "residential": (3.8, "#463c31"), "service": (2.4, "#3a332a"),
    "living_street": (3.8, "#463c31"), "pedestrian": (3.2, "#3b332a"),
    "footway": (1.5, "#2d2822"), "path": (1.3, "#2b2621"),
    "cycleway": (1.7, "#2f2a23"), "steps": (2.0, "#342e27"),
}
DASHED = {"footway", "path", "steps", "cycleway"}
RIVER_W = {"黄浦江": 420.0, "淀浦河": 24.0, "华泾港": 16.0, "春申港": 14.0}
CORE_R = 900.0  # 只在学院这个半径内画建筑轮廓，远处的只留路网
ccx, ccy = px(*CAMPUS)

buildings, roads, water_polys, water_lines, greens = [], [], [], [], []
for _wid, (tags, refs) in ways.items():
    pts = project(refs)
    if not pts:
        continue
    if tags.get("highway"):
        roads.append((tags["highway"], pts, tags.get("name")))
    if "building" in tags and len(pts) >= 3:
        if min(math.hypot(x - ccx, y - ccy) for x, y in pts) < CORE_R * SCALE:
            buildings.append(pts)
    if tags.get("natural") == "water" and len(pts) >= 3:
        ws = [p[0] for p in pts]
        hs = [p[1] for p in pts]
        if (max(ws) - min(ws)) < W * 1.2 and (max(hs) - min(hs)) < H * 1.2:
            water_polys.append(pts)
    if tags.get("waterway") in ("river", "canal", "stream", "ditch"):
        w = float(tags.get("width", 0) or 0) or RIVER_W.get(tags.get("name", ""), 13.0)
        water_lines.append((max(7.0, w * SCALE), pts))
    if (tags.get("leisure") in ("park", "garden")
            or tags.get("landuse") in ("grass", "forest")
            or tags.get("natural") in ("wood", "scrub")):
        ws = [p[0] for p in pts]
        hs = [p[1] for p in pts]
        if len(pts) >= 3 and (max(ws) - min(ws)) < W * 1.2 and (max(hs) - min(hs)) < H * 1.2:
            greens.append(pts)

S = [
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" '
    f'role="group" aria-label="学院周边餐馆位置图" class="map-svg">',
    f'<rect width="{W:.0f}" height="{H:.0f}" fill="#14100c"/>',
    '<defs><radialGradient id="map-vignette" cx="50%" cy="50%" r="72%">'
    '<stop offset="55%" stop-color="#14100c" stop-opacity="0"/>'
    '<stop offset="100%" stop-color="#14100c" stop-opacity="0.85"/>'
    "</radialGradient></defs>",
]

S.append('<g class="map-greens">')
for pts in greens:
    if in_view(pts):
        S.append(f'<path d="{path_of(pts, True)}" fill="#1c2619"/>')
S.append("</g>")

S.append('<g class="map-water">')
for pts in water_polys:
    if in_view(pts):
        S.append(f'<path d="{path_of(pts, True)}" fill="#182329"/>')
for w, pts in water_lines:
    if in_view(pts):
        S.append(f'<path d="{path_of(pts)}" fill="none" stroke="#182329" stroke-width="{w:.0f}" '
                 'stroke-linecap="round" stroke-linejoin="round"/>')
S.append("</g>")

S.append('<g class="map-buildings">')
S.append(f'<path d="{"".join(path_of(p, True, 1.4) for p in buildings if in_view(p))}" '
         'fill="#221b14" stroke="#2a221a" stroke-width="0.6"/>')
S.append("</g>")

# 路面：先按等级画一遍深色描边，再画一遍填充；同等级的合并成一条 path，体积能小一个量级
casing, fills = {}, {}
for hw, pts, _name in roads:
    if not in_view(pts):
        continue
    cls = hw if hw in ROAD_STYLE else "service"
    casing.setdefault(cls, []).append(path_of(pts, eps=1.6))
    fills.setdefault(cls, []).append(path_of(pts, eps=1.6))

S.append('<g class="map-roads" fill="none" stroke-linecap="round" stroke-linejoin="round">')
for hw in ROAD_ORDER + sorted(set(casing) - set(ROAD_ORDER)):
    if hw in casing:
        w = ROAD_STYLE.get(hw, (2.0, ""))[0]
        S.append(f'<path d="{"".join(casing[hw])}" stroke="#0d0a07" stroke-width="{w + 2:.0f}"/>')
for hw in ROAD_ORDER + sorted(set(fills) - set(ROAD_ORDER)):
    if hw in fills:
        w, col = ROAD_STYLE.get(hw, (2.0, "#362f26"))
        dash = ' stroke-dasharray="4 4"' if hw in DASHED else ""
        S.append(f'<path d="{"".join(fills[hw])}" stroke="{col}" stroke-width="{w:.0f}"{dash}/>')
S.append("</g>")

def box(x, y, w, h):
    return (x, y, x + w, y + h)


taken = []  # 已被占用的文字/图形范围，餐馆标签要避开

LABEL_ROADS = {"华发路", "建华路", "业祥路", "罗香路", "华泾路", "长华路", "老沪闵路",
               "外环高速", "龙吴路", "淀浦河", "华泾港", "朱梅路", "徐梅路", "龙腾大道",
               "罗秀路"}
S.append('<g class="map-roadnames" font-family="PingFang SC, Noto Sans SC, sans-serif">')
seen = set()
for _hw, pts, name in roads:
    if not name or name in seen or name not in LABEL_ROADS or not in_view(pts):
        continue
    best = None
    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        d = math.hypot(x2 - x1, y2 - y1)
        if d > 80 and (best is None or d > best[0]):
            best = (d, x1, y1, x2, y2)
    if not best:
        continue
    _, x1, y1, x2, y2 = best
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    if not (80 < cx < W - 80 and 60 < cy < H - 60):
        continue
    seen.add(name)
    ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
    if ang > 90:
        ang -= 180
    if ang < -90:
        ang += 180
    taken.append(box(cx - len(name) * 7, cy - 10, len(name) * 14, 20))  # 旋转后的占位留宽一点
    S.append(f'<text x="{cx:.0f}" y="{cy:.0f}" font-size="13.5" fill="#8a7864" text-anchor="middle" '
             f'dominant-baseline="middle" transform="rotate({ang:.1f} {cx:.0f} {cy:.0f})" '
             f'letter-spacing="2.5" opacity="0.85">{name}</text>')
S.append("</g>")

S.append(f'<rect width="{W:.0f}" height="{H:.0f}" fill="url(#map-vignette)" pointer-events="none"/>')


def hit(a, b, pad=0):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


def label_box(x, y, text, size, anchor):
    w = len(text) * size
    h = size * 1.25
    if anchor == "start":
        return box(x, y - h / 2, w, h)
    if anchor == "end":
        return box(x - w, y - h / 2, w, h)
    return box(x - w / 2, y - h / 2, w, h)


# 标签按「离标记由近到远」试位置，撞上了就换下一个方向，太远就拉一根引导线
CANDIDATES = []
for radius in (15, 24, 34, 46):
    for ang in (-60, -120, -30, -150, 0, 180, 30, 150, 60, 120, 90, -90):
        a = math.radians(ang)
        CANDIDATES.append((radius * math.cos(a), radius * math.sin(a) * 0.85))

taken.append(box(ccx - 26, ccy - 26, 52, 52))
dots = []
for slug, label, lat, lon in SHOPS:
    x, y = px(lat, lon)
    dots.append((slug, label, x, y))
    taken.append(box(x - 8, y - 8, 16, 16))

S.append('<g class="map-shopnames" font-family="PingFang SC, Noto Sans SC, sans-serif">')
for slug, label, x, y in dots:
    size = 13.5
    best = None
    for dx, dy in CANDIDATES:
        anchor = "start" if dx > 6 else "end" if dx < -6 else "middle"
        lx, ly = x + dx, y + dy
        b = label_box(lx, ly, label, size, anchor)
        if b[0] < 10 or b[2] > W - 10 or b[1] < 10 or b[3] > H - 10:
            continue
        if any(hit(b, t, 5) for t in taken):
            continue
        best = (lx, ly, anchor, b, dx, dy)
        break
    if best is None:
        lx, ly = x + 16, y - 16
        best = (lx, ly, "start", label_box(lx, ly, label, size, "start"), 16, -16)
    lx, ly, anchor, b, dx, dy = best
    taken.append(b)
    S.append(f'<a href="{{{{base}}}}restaurants/{slug}/" class="map-pin" data-map-slug="{slug}">')
    S.append(f"<title>{label}</title>")
    if math.hypot(dx, dy) > 20:
        ex = lx - 4 if anchor == "start" else lx + 4 if anchor == "end" else lx
        S.append(f'<path d="M{x:.0f} {y:.0f}L{ex:.0f} {ly:.0f}" stroke="#6b5947" '
                 'stroke-width="1.1" opacity="0.8"/>')
    S.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="7" fill="#d34731" stroke="#14100c" stroke-width="2"/>')
    S.append(f'<text x="{lx:.0f}" y="{ly:.0f}" font-size="{size}" fill="#fbf0dc" text-anchor="{anchor}" '
             'dominant-baseline="middle" stroke="#14100c" stroke-width="3.4" paint-order="stroke" '
             f'stroke-linejoin="round">{label}</text>')
    S.append("</a>")
S.append("</g>")

star_r = 17.0
star = []
for i in range(10):
    ang = math.radians(-90 + i * 36)
    r = star_r if i % 2 == 0 else star_r * 0.42
    star.append(f"{ccx + r * math.cos(ang):.1f},{ccy + r * math.sin(ang):.1f}")
S.append('<g class="map-campus">')
S.append(f'<circle cx="{ccx:.0f}" cy="{ccy:.0f}" r="{star_r + 9:.0f}" fill="none" '
         'stroke="#f2c14e" stroke-width="1.2" opacity="0.35"/>')
S.append(f'<polygon points="{" ".join(star)}" fill="#f2c14e" stroke="#14100c" stroke-width="2.4"/>')
S.append(f'<text x="{ccx:.0f}" y="{ccy - star_r - 12:.0f}" font-size="15" font-weight="600" '
         'fill="#f2c14e" text-anchor="middle" stroke="#14100c" stroke-width="4" paint-order="stroke" '
         'stroke-linejoin="round" font-family="PingFang SC, Noto Sans SC, sans-serif" '
         'letter-spacing="1">上海创智学院</text>')
S.append("</g>")

bar = 500 * SCALE
bx, by = 34, H - 40
S.append('<g class="map-scale" font-family="PingFang SC, Noto Sans SC, sans-serif">')
S.append(f'<path d="M{bx} {by}h{bar:.0f}" stroke="#5f5145" stroke-width="3"/>')
S.append(f'<path d="M{bx} {by - 5}v10M{bx + bar:.0f} {by - 5}v10" stroke="#5f5145" stroke-width="3"/>')
S.append(f'<text x="{bx + bar / 2:.0f}" y="{by - 12:.0f}" font-size="12.5" fill="#8a7864" '
         'text-anchor="middle" letter-spacing="1">500 米</text>')
S.append("</g>")

S.append("</svg>")
svg = "\n".join(S)
with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(svg)
print(f"{OUT}: {len(svg) / 1024:.0f} KB, {len(buildings)} 栋建筑, {len(SHOPS)} 家店")
