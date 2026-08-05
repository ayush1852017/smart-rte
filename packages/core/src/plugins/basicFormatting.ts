import {
  applyBackgroundColor,
  applyFontSize,
  applyFontFamily,
  applyTextColor,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrike,
  toggleSubscript,
  toggleSuperscript,
  toggleUnderline,
} from "../legacyCommands/marks.js";
import type { SmartRtePlugin } from "../plugin.js";

/**
 * Inline formatting as an independently selectable feature bundle.
 *
 * Applications may use the singleton or create a fresh plugin descriptor when
 * composing an editor preset. Commands remain model-only and UI-framework-free.
 */
export const createBasicFormattingPlugin = (): SmartRtePlugin => ({
  id: "basic-formatting",
  commands: {
    [toggleBold.id]: toggleBold,
    [toggleItalic.id]: toggleItalic,
    [toggleUnderline.id]: toggleUnderline,
    [toggleStrike.id]: toggleStrike,
    [toggleInlineCode.id]: toggleInlineCode,
    [toggleSuperscript.id]: toggleSuperscript,
    [toggleSubscript.id]: toggleSubscript,
    [applyTextColor.id]: applyTextColor,
    [applyBackgroundColor.id]: applyBackgroundColor,
    [applyFontSize.id]: applyFontSize,
    [applyFontFamily.id]: applyFontFamily,
  },
});

export const basicFormattingPlugin = createBasicFormattingPlugin();
