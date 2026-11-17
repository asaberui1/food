export const siteConfig = {
  name: "创智食单",
  title: "创智食单 · 上海创智学院周边餐馆指南",
  description:
    "上海创智学院周边的餐馆指南：一家一家吃过去，记下环境、菜单、人均和值得点的那一道菜。",
  locale: "zh_CN",
  defaultImage: "/og.png",
  nav: [
    { label: "首页", href: "/" },
    { label: "全部餐馆", href: "/restaurants/" },
    { label: "关于", href: "/about/" },
  ],
  // 学校信息：首页页脚与「关于」页展示，可按需修改
  school: {
    name: "上海创智学院",
    short: "创智学院",
    note: "以学院为圆心，步行十五分钟内。",
  },
  contact: {
    // 投稿/纠错邮箱，可换成你的常用邮箱
    email: "739401566@qq.com",
  },
  social: [
    { label: "GitHub", href: "https://github.com/asaberui1" },
  ],
  effects: {
    reveal: true,
  },
} as const;

export type SiteConfig = typeof siteConfig;
