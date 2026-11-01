import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { propertyLabel, frontmatterSummary } from "./frontmatter.js";

// Metadata has its own small, collapsible region. Markdown rendering gets body
// only; the readonly source Editor still receives the entire original document.
export function frontmatterView(metadata, expanded, theme, toggle) {
  const summary = frontmatterSummary(metadata);
  // A flex scroll region cannot infer its height from its overflowing contents.
  const detailHeight = metadata.fallback ? Math.min(180, 16 * metadata.raw.split(/\r\n|\n|\r/).length + 16) :
    Math.min(180, Math.max(1, Math.min(100, metadata.properties.length)) * 28 + 12);
  return v_flex().id("frontmatter-properties").flex_none().min_w(0).mb(16)
    .border_b(1).border_color(theme.border)
    .child(h_flex().id("toggle-properties").h(30).min_w(0).gap(8).px(4).rounded(4)
      .cursor_pointer().hover(el => el.bg(theme.hover)).accessibility_label(expanded ? "속성 접기" : "속성 펼치기")
      .on_click((_event, cx) => toggle(cx))
      .child(div().flex_none().text_size(11).text_color(theme.dim).child(expanded ? "▾" : "▸"))
      .child(div().flex_none().text_size(11).font_semibold().text_color(theme.muted).child("속성"))
      .child(div().flex_none().text_size(10).text_color(theme.dim).child(metadata.fallback ? "YAML" : String(metadata.properties.length)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(theme.dim).tooltip(summary).child(metadata.fallback ? "펼쳐서 YAML 확인" : summary)))
    .when(expanded, el => el.child(v_flex().id("property-values").h(detailHeight).flex_none().min_h(0).overflow_y_scrollbar().px(5).py(6).gap(3)
      .when(metadata.fallback, el => el
        .child(div().text_size(11).text_color(theme.muted).child(metadata.raw.slice(0, 16000)))
        .when(metadata.raw.length > 16000, el => el.child(div().text_size(11).text_color(theme.dim).child("나머지 속성은 원문에서 확인하세요."))))
      .when(!metadata.fallback, el => el
        .children(metadata.properties.slice(0, 100).map((property, index) => h_flex().id(`property-${index}`).h(25).min_w(0).gap(12).flex_none()
          .child(div().w(100).flex_none().truncate().text_size(11).text_color(theme.dim).tooltip(property.key).child(property.key))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(theme.muted).tooltip(property.value).child(propertyLabel(property.value)))))
        .when(!metadata.properties.length, el => el.child(div().text_size(11).text_color(theme.dim).child("속성이 없습니다.")))
        .when(metadata.properties.length > 100, el => el.child(div().text_size(11).text_color(theme.dim).child("처음 100개 속성 표시 · 나머지는 원문에서 확인하세요."))))));
}
