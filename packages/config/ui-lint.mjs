// apps/admin/CLAUDE.md "Cấm": no colour, font size, spacing or radius outside packages/ui/tokens.css.
// packages/ui/theme.css removes Tailwind's own scales; these selectors catch what a theme cannot: arbitrary values
// (`text-[13px]`, `bg-[#fff]`), colours written in code and the typography or colour of a `style` prop.
// rawCssSelectors do the same for the stylesheets of an app (@eslint/css, CSSTree nodes); tokens.css itself is not linted with them.
const message =
  'Dùng token của packages/ui (class Tailwind theo theme.css), không viết giá trị màu/cỡ chữ/khoảng cách trực tiếp.';

// Arbitrary values on a utility that sets colour, type, spacing, radius or shadow; sizes (w-[240px]) stay allowed.
const arbitrary = String.raw`(^|[\s:])-?(text|bg|border(-[xytrblse])?|ring|outline|fill|stroke|from|via|to|shadow|rounded(-[a-z]+)?|decoration|accent|caret|placeholder|divide|p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy]|inset(-[xy])?|top|right|bottom|left|font|leading|tracking)-\[`;
// A whole string that is a hex colour, or a CSS colour function anywhere in a string.
const colour = String.raw`^#[0-9a-f]{3,8}$|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(`;
const styled = String.raw`^(color|background(Color)?|border(Color)?|outlineColor|fill|stroke|fontSize|fontFamily|lineHeight|padding\w*|margin\w*|gap|rowGap|columnGap|borderRadius|boxShadow)$`;

export const rawStyleSelectors = [
  `Literal[value=/${arbitrary}/]`,
  `TemplateElement[value.raw=/${arbitrary}/]`,
  `Literal[value=/${colour}/i]`,
  `TemplateElement[value.raw=/${colour}/i]`,
  `JSXAttribute[name.name='style'] Property[key.name=/${styled}/][value.type='Literal']`,
].map((selector) => ({ selector, message }));

export const rawCssSelectors = [
  'Hash',
  `Function[name=/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/i]`,
  `Dimension[unit=/^(px|pt|em|rem)$/i]`,
].map((selector) => ({ selector, message }));
