import type { I18n } from '../i18n/index.tsx';
import type { ComposerMessageKey } from '../i18n/composer-messages.ts';

// Older persisted drafts contain these messages as strings. Translate only known
// product messages at presentation time, leaving the persisted draft untouched.
const knownIssues: Readonly<Record<string, ComposerMessageKey>> = {
  '此草稿包含格式或上下文，当前编辑器不能无损编辑。': 'This draft contains formatting or context that cannot be edited without loss.',
  '保存的草稿包含无法读取的内容，已保留原始数据。': 'The saved draft contains unreadable content. The original data has been retained.',
  '此草稿包含尚不支持的文档内容，已保留原始数据。': 'This draft contains unsupported document content. The original data has been retained.',
  '此草稿的文档与保存的文本不一致，已保留两个版本。': 'The document and saved text differ. Both versions have been retained.',
  '此草稿的文档格式无法读取，已保留原始数据。': 'The document format could not be read. The original data has been retained.',
  '此草稿包含未识别的内容，已保留原始数据。': 'This draft contains unrecognized content. The original data has been retained.',
  '此草稿包含不同版本的文档，均已保留。': 'This draft contains multiple document versions. All have been retained.',
  '此草稿包含额外文档信息，当前编辑器不能无损编辑。': 'This draft contains extra document information that cannot be edited without loss.',
  '此草稿包含额外上下文，当前编辑器不能无损编辑。': 'This draft contains extra context that cannot be edited without loss.',
  '此草稿包含格式，当前编辑器不能无损编辑。': 'This draft contains formatting that cannot be edited without loss.',
  '此草稿包含提示信息，当前编辑器不能无损编辑。': 'This draft contains hints that cannot be edited without loss.',
  '此消息包含格式化或分段内容，当前编辑器不能无损编辑。': 'This message contains formatted or segmented content that cannot be edited without loss.',
  '此技能引用包含额外信息，当前编辑器不能无损编辑。': 'This skill reference contains extra information that cannot be edited without loss.',
};

export function localizeDraftIssue(issue: string, t: I18n['t']): string {
  const key = Object.hasOwn(knownIssues, issue) ? knownIssues[issue] : undefined;
  return key ? t(key) : issue;
}
