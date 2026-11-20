#!/usr/bin/env python3
"""把 OSM 数据渲染成站点配色的矢量地图：python3 scripts/map-render.py

输出 src/assets/map/neighbourhood.svg，由 src/components/ShopMap.astro 内联到页面。

要先拿到数据。OSM 官方 API 单次上限 5 万要素，学院周边 4 公里见方要切成四块再合并：

    for i in 1 2 3 4; do  # 121.395–121.479 / 31.091–31.163，切成 4 块
      curl -o /tmp/tile_$i.xml "https://api.openstreetmap.org/api/0.6/map?bbox=..."
    done
    python3 -c "..."   # 按 id 去重合并成 /tmp/osm4k.xml

（合并脚本见仓库提交记录；国内直连要挂代理时加 `-x http://127.0.0.1:7890`。）
数据下到 4 公里，图现在只渲染街区尺度的一段（LON0..LAT1 这几个常量），
以后收远的店把窗口放大即可，不用重新下载。
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
# (slug, 图上名字, 纬度, 经度, 所在街道, 街的哪一侧 s=南 n=北)
SHOPS = [
    ("yunxi-jiujia", "云西酒家", 31.123970, 121.442079, "建华路", "s"),
    ("huajing-jiachangcai", "华泾家常菜", 31.123021, 121.439863, "建华路", "s"),
    ("nanjing-tangbaodian", "南京汤包店", 31.123154, 121.440558, "建华路", "s"),
    ("huji-guotie", "胡记锅贴", 31.128805, 121.445465, "华发路", "s"),
    ("suzhou-cangshu-yangrou", "苏州藏书羊肉面馆", 31.128817, 121.445159, "华发路", "s"),
    ("niuboshi-niurou", "牛博士牛肉汤馆", 31.128812, 121.445042, "华发路", "s"),
    ("longmianwang-hangzhou-xiaochi", "笼面王·杭州小吃", 31.128724, 121.443496, "华发路", "s"),
    ("yigou-hundunmian", "一碗勾馄面", 31.128872, 121.449385, "华发路", "s"),
    ("niumaixiang-niuroumian", "牛麦香·红烧牛肉面", 31.127449, 121.430825, "业祥路", "n"),
    ("youziyouwei-jiangxixiaochao", "有滋有味·江西小炒", 31.126606, 121.429570, "业祥路", "s"),
    ("xibeihong-lamian", "西北红拉面", 31.137956, 121.437454, "罗香路", "s"),
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

by_name = {}
for _hw, _pts, _name in roads:
    if _name:
        by_name.setdefault(_name, []).append(_pts)


def box(x, y, w, h):
    return (x, y, x + w, y + h)


def hit(a, b, pad=0):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


def label_box(x, y, text, size, anchor):
    w = len(text) * size
    h = size * 1.3
    if anchor == "start":
        return box(x, y - h / 2, w, h)
    if anchor == "end":
        return box(x - w, y - h / 2, w, h)
    return box(x - w / 2, y - h / 2, w, h)


def seg_closest(p, a, b):
    """点 p 在线段 ab 上的最近点"""
    ax, ay = a
    dx, dy = b[0] - ax, b[1] - ay
    if dx == 0 and dy == 0:
        return a
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)))
    return (ax + t * dx, ay + t * dy)


def street_point(p, street):
    """门店到所在街道中心线最近的点"""
    best = None
    for poly in by_name.get(street, []):
        for i in range(len(poly) - 1):
            c = seg_closest(p, poly[i], poly[i + 1])
            d = math.hypot(c[0] - p[0], c[1] - p[1])
            if best is None or d < best[0]:
                best = (d, c)
    return best


# 门店多数贴着街边开，POI 坐标常常落在路中心线上：先吸附到所在街道，
# 再统一往南挪 30 米（临街那排房子），本来就在弄堂深处的店保持原位。
SNAP_PX = 24.0            # 离街 48 米内算「沿街」，再远就当作在弄堂/院子里
SOUTH_OFFSET = 24 * SCALE  # 往南 24 米（临街那排房子）
HEAD_R = 11.0               # 针头半径
PIN_H = 27.0               # 针尖到针头圆心的距离：针尖才是门店的真实位置

placed = []
for slug, label, lat, lon, street, side in SHOPS:
    p = px(lat, lon)
    snapped = street_point(p, street)
    if snapped and snapped[0] < SNAP_PX:
        shift = SOUTH_OFFSET if side == "s" else -SOUTH_OFFSET
        x, y = snapped[1][0], snapped[1][1] + shift
    else:
        x, y = p
    placed.append((slug, label, x, y))

ccx, ccy = px(*CAMPUS)

S = [
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" '
    f'role="group" aria-label="学院周边餐馆位置图" class="map-svg">',
    f'<rect width="{W:.0f}" height="{H:.0f}" fill="#14100c"/>',
    '<defs><radialGradient id="map-vignette" cx="50%" cy="50%" r="72%">'
    '<stop offset="52%" stop-color="#14100c" stop-opacity="0"/>'
    '<stop offset="100%" stop-color="#14100c" stop-opacity="0.9"/>'
    "</radialGradient>"
    '<radialGradient id="campus-glow">'
    '<stop offset="0%" stop-color="#f2c14e" stop-opacity="0.3"/>'
    '<stop offset="70%" stop-color="#f2c14e" stop-opacity="0.08"/>'
    '<stop offset="100%" stop-color="#f2c14e" stop-opacity="0"/>'
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

# ---- 街道名：在同一条路的多个位置里挑一个离餐馆最远的，避免压到红点和标签 ----
LABEL_ROADS = {"华发路", "建华路", "业祥路", "罗香路", "华泾路", "长华路", "老沪闵路",
               "外环高速", "龙吴路", "淀浦河", "华泾港", "朱梅路", "徐梅路", "龙腾大道",
               "罗秀路"}
pins = [(x, y) for _s, _l, x, y in placed]

S.append('<g class="map-roadnames" font-family="PingFang SC, Noto Sans SC, sans-serif">')
street_boxes = []
for name in LABEL_ROADS:
    best = None
    for poly in by_name.get(name, []):
        for i in range(len(poly) - 1):
            (x1, y1), (x2, y2) = poly[i], poly[i + 1]
            seg = math.hypot(x2 - x1, y2 - y1)
            steps = max(1, int(seg // 34))
            for k in range(steps):
                t = (k + 0.5) / steps
                cx, cy = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
                if not (110 < cx < W - 110 and 60 < cy < H - 55):
                    continue
                ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
                if ang > 90:
                    ang -= 180
                if ang < -90:
                    ang += 180
                w = len(name) * 15.5
                b = (cx - w / 2, cy - 9, cx + w / 2, cy + 9)
                if any(hit(b, t_, 8) for t_ in street_boxes):
                    continue
                clear = min((math.hypot(px_ - cx, py_ - cy) for px_, py_ in pins), default=999)
                score = min(clear, 260) - (0.15 * abs(cy - H / 2))
                if best is None or score > best[0]:
                    best = (score, cx, cy, ang, b)
    if not best:
        continue
    _score, cx, cy, ang, b = best
    street_boxes.append(b)
    S.append(f'<text x="{cx:.0f}" y="{cy:.0f}" font-size="14.5" fill="#8f7c66" text-anchor="middle" '
             f'dominant-baseline="middle" transform="rotate({ang:.1f} {cx:.0f} {cy:.0f})" '
             f'letter-spacing="2.5" opacity="0.85">{name}</text>')
S.append("</g>")

S.append(f'<rect width="{W:.0f}" height="{H:.0f}" fill="url(#map-vignette)" pointer-events="none"/>')

# ---- 餐馆：大头针 ----
taken = [box(ccx - 34, ccy - 34, 68, 68)] + street_boxes
for _slug, _label, x, y in placed:
    taken.append(box(x - HEAD_R - 4, y - PIN_H - HEAD_R - 4, HEAD_R * 2 + 8, PIN_H + HEAD_R * 2 + 10))

S.append('<g class="map-pins" font-family="PingFang SC, Noto Sans SC, sans-serif">')
for slug, label, x, y in placed:
    head_y = y - PIN_H          # 针头圆心
    S.append(f'<a href="{{{{base}}}}restaurants/{slug}/" class="map-pin" data-map-slug="{slug}">')
    S.append(f"<title>{label}</title>")
    S.append(f'<ellipse cx="{x:.0f}" cy="{y + 1:.0f}" rx="3.2" ry="1.4" fill="#0b0806" opacity="0.45"/>')
    # 针脚：一根灰色细直线，末端压在门店位置上
    S.append(f'<path d="M{x:.0f} {y:.0f}V{head_y + 2:.0f}" stroke="#9b938a" '
             'stroke-width="2.2" stroke-linecap="round"/>')
    S.append(f'<circle cx="{x:.0f}" cy="{head_y:.0f}" r="{HEAD_R}" fill="#d34731" '
             'stroke="#fbf0dc" stroke-width="2.2"/>')
    S.append("</a>")
S.append("</g>")

# ---- 店名：从针头往外试位置，撞上就换方向，远了拉引导线 ----
CANDIDATES = []
for radius in (18, 26, 36, 48, 62, 78):
    for ang in (30, 150, 0, 180, -30, -150, 60, 120, -60, -120, -90):
        a = math.radians(ang)
        CANDIDATES.append((radius * math.cos(a), radius * math.sin(a) * 0.8))

S.append('<g class="map-shopnames" font-family="PingFang SC, Noto Sans SC, sans-serif">')
for slug, label, x, y in placed:
    size = 14.0
    best = None
    for dx, dy in CANDIDATES:
        anchor = "start" if dx > 5 else "end" if dx < -5 else "middle"
        lx, ly = x + dx, y - PIN_H + dy
        b = label_box(lx, ly, label, size, anchor)
        if b[0] < 10 or b[2] > W - 10 or b[1] < 10 or b[3] > H - 10:
            continue
        if any(hit(b, t, 7) for t in taken):
            continue
        best = (lx, ly, anchor, b, dx, dy)
        break
    if best is None:
        lx, ly = x + 16, y - PIN_H - 14
        best = (lx, ly, "start", label_box(lx, ly, label, size, "start"), 16, -14)
    lx, ly, anchor, b, dx, dy = best
    taken.append(b)
    if math.hypot(dx, dy) > 22:
        ex = lx - 6 if anchor == "start" else lx + 6 if anchor == "end" else lx
        S.append(f'<path d="M{x:.0f} {y - PIN_H:.0f}L{ex:.0f} {ly:.0f}" stroke="#7d6a56" '
                 'stroke-width="1" opacity="0.65"/>')
    S.append(f'<text x="{lx:.0f}" y="{ly:.0f}" font-size="{size}" fill="#fbf0dc" text-anchor="{anchor}" '
             'dominant-baseline="middle" stroke="#14100c" stroke-width="3.6" paint-order="stroke" '
             f'stroke-linejoin="round">{label}</text>')
S.append("</g>")

# ---- 学院：圆形徽章 + 五角星 ----
BADGE_R = 24.0
S.append('<g class="map-campus" font-family="PingFang SC, Noto Sans SC, sans-serif">')
S.append(f'<circle cx="{ccx:.0f}" cy="{ccy:.0f}" r="{BADGE_R + 16:.0f}" fill="url(#campus-glow)"/>')
S.append(f'<circle cx="{ccx:.0f}" cy="{ccy:.0f}" r="{BADGE_R:.0f}" fill="#fbeecb" stroke="#14100c" stroke-width="2.4"/>')
star = []
for i in range(10):
    ang = math.radians(-90 + i * 36)
    r = 15.0 if i % 2 == 0 else 6.4
    star.append(f"{ccx + r * math.cos(ang):.1f},{ccy + r * math.sin(ang):.1f}")
S.append(f'<polygon points="{" ".join(star)}" fill="#d98a34"/>')
S.append(f'<text x="{ccx:.0f}" y="{ccy + BADGE_R + 17:.0f}" font-size="16" font-weight="600" '
         'fill="#f7e6bf" text-anchor="middle" stroke="#14100c" stroke-width="4" paint-order="stroke" '
         'stroke-linejoin="round" letter-spacing="1">上海创智学院</text>')
S.append("</g>")

bar = 500 * SCALE
bx, by = 34, H - 40
S.append('<g class="map-scale" font-family="PingFang SC, Noto Sans SC, sans-serif">')
S.append(f'<path d="M{bx} {by}h{bar:.0f}" stroke="#5f5145" stroke-width="3"/>')
S.append(f'<path d="M{bx} {by - 5}v10M{bx + bar:.0f} {by - 5}v10" stroke="#5f5145" stroke-width="3"/>')
S.append(f'<text x="{bx + bar / 2:.0f}" y="{by - 12:.0f}" font-size="13.5" fill="#8a7864" '
         'text-anchor="middle" letter-spacing="1">500 米</text>')
S.append("</g>")

S.append("</svg>")
svg = "\n".join(S)
with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(svg)
print(f"{OUT}: {len(svg) / 1024:.0f} KB, {len(buildings)} 栋建筑, {len(SHOPS)} 家店")
