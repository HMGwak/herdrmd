import { View } from "gpui-kit";
import { props } from "herdr";
import { VaultReader } from "./vault-view.js";

export default class Herdrmd extends View {
  init(_props, cx) {
    this.reader = new VaultReader(props() || {}, cx);
  }

  close(_cx) {
    this.reader?.close();
  }

  render(cx) {
    return this.reader.render(cx);
  }
}
