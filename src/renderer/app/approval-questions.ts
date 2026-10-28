export interface ApprovalQuestion {
  id: string;
  header?: string;
  question: string;
  isSecret?: boolean;
  isOther?: boolean;
  options?: { label: string; description?: string }[] | null;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function questionsFrom(value: unknown): ApprovalQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = new Set<string>();
  const questions: ApprovalQuestion[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.question !== 'string'
      || (item.header != null && typeof item.header !== 'string') || (item.isSecret != null && typeof item.isSecret !== 'boolean')
      || (item.isOther != null && typeof item.isOther !== 'boolean')
      || (item.options != null && (!Array.isArray(item.options) || !item.options.every((option: unknown) =>
        record(option) && typeof option.label === 'string' && (option.description == null || typeof option.description === 'string'))))) return null;
    if (Array.isArray(item.options)) {
      const labels = item.options.map((option: { label: string }) => option.label);
      if (labels.some((label: string) => !label.trim()) || new Set(labels).size !== labels.length) return null;
    }
    ids.add(item.id);
    questions.push(item as unknown as ApprovalQuestion);
  }
  return questions;
}
