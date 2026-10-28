type Option = { value: string; label: string };
type CommonField = { key: string; title: string; description?: string; required: boolean };
export type ApprovalResourceOption = { uri: string; name: string; title?: string; description?: string };
export type ApprovalUserOptions = { kind?: 'file' | 'directory'; accept?: string[] };
export type ApprovalField =
  | (CommonField & { kind: 'string'; minLength?: number; maxLength?: number; format?: 'email' | 'uri' | 'date' | 'date-time'; default?: string })
  | (CommonField & { kind: 'select'; options: Option[]; default?: string })
  | (CommonField & { kind: 'multi'; options: Option[]; minItems?: number; maxItems?: number; default?: string[] })
  | (CommonField & { kind: 'number' | 'integer'; minimum?: number; maximum?: number; default?: number })
  | (CommonField & { kind: 'boolean'; default?: boolean })
  | (CommonField & { kind: 'image'; items: { id: string; title: string; image: string }[];
      file?: { accept?: string[]; title?: string }; default?: string })
  | (CommonField & { kind: 'resource' | 'resources'; options: ApprovalResourceOption[]; userOptions?: ApprovalUserOptions;
      selection?: 'explicit' | 'implicit'; minItems?: number; maxItems?: number; default?: string | string[] });
export type ApprovalFormValues = Record<string, string | string[]>;
export type ApprovalForm = { fields: ApprovalField[] };
export type FormParse = { form: ApprovalForm; error?: never } | { form?: never; error: string };
export type FormValidation =
  | { content: Record<string, string | number | boolean | string[]>; errors?: never }
  | { content?: never; errors: Record<string, string> };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionsFromEnum(value: unknown, names?: unknown): Option[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string')
    || new Set(value).size !== value.length) return null;
  if (names !== undefined && (!Array.isArray(names) || names.length !== value.length
    || !names.every((name) => typeof name === 'string'))) return null;
  return value.map((item, index) => ({ value: item as string, label: names === undefined ? item as string : (names as string[])[index]! }));
}

function optionsFromConst(value: unknown): Option[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result: Option[] = [];
  for (const option of value) {
    if (!record(option) || !hasOnly(option, ['const', 'title']) || typeof option.const !== 'string'
      || typeof option.title !== 'string') return null;
    result.push({ value: option.const, label: option.title });
  }
  return new Set(result.map((option) => option.value)).size === result.length ? result : null;
}

type FormMode = 'mcp' | 'openai' | 'legacy-openai';
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}
function parseField(key: string, value: unknown, required: boolean, mode: FormMode): ApprovalField | null {
  if (!record(value) || (value.title !== undefined && typeof value.title !== 'string')
    || (value.description !== undefined && typeof value.description !== 'string')) return null;
  const common: CommonField = { key, title: typeof value.title === 'string' ? value.title : key, required,
    ...(typeof value.description === 'string' ? { description: value.description } : {}) };
  if (mode === 'legacy-openai' && value.type === 'openai/imagePicker') {
    if (!hasOnly(value, ['type', 'title', 'description', 'items', 'file']) || !Array.isArray(value.items)) return null;
    const items: { id: string; title: string; image: string }[] = [];
    for (const item of value.items) {
      if (!record(item) || !hasOnly(item, ['id', 'title', 'image']) || typeof item.id !== 'string' || !item.id.trim()
        || typeof item.title !== 'string' || !item.title.trim() || typeof item.image !== 'string'
        || !/^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$/.test(item.image)) return null;
      items.push({ id: item.id, title: item.title, image: item.image });
    }
    if (new Set(items.map(item => item.id)).size !== items.length) return null;
    let file: { accept?: string[]; title?: string } | undefined;
    if (value.file !== undefined) {
      if (!record(value.file) || !hasOnly(value.file, ['accept', 'title'])
        || value.file.title !== undefined && typeof value.file.title !== 'string'
        || value.file.accept !== undefined && (!strings(value.file.accept) || value.file.accept.some(item => !item.trim()))) return null;
      file = { ...(strings(value.file.accept) ? { accept: value.file.accept } : {}),
        ...(typeof value.file.title === 'string' ? { title: value.file.title } : {}) };
    }
    return items.length || file ? { ...common, kind: 'image', items, ...(file ? { file } : {}) } : null;
  }
  if (mode === 'openai' && value['x-openai-input'] !== undefined) {
    const input = value['x-openai-input'];
    const multiple = value.type === 'array';
    if (!record(input) || !hasOnly(input, ['type', 'options', 'userOptions', 'selection']) || input.type !== 'resource'
      || !Array.isArray(input.options) || !['string', 'array'].includes(String(value.type))
      || !hasOnly(value, multiple ? ['type', 'title', 'description', 'default', 'items', 'minItems', 'maxItems', 'x-openai-input']
        : ['type', 'title', 'description', 'default', 'format', 'x-openai-input'])
      || multiple && (!record(value.items) || !hasOnly(value.items, ['type', 'format']) || value.items.type !== 'string' || value.items.format !== 'uri')
      || !multiple && (value.format !== 'uri' || input.selection !== undefined)
      || input.selection !== undefined && input.selection !== 'explicit' && input.selection !== 'implicit'
      || value.minItems !== undefined && !count(value.minItems) || value.maxItems !== undefined && !count(value.maxItems)
      || typeof value.minItems === 'number' && typeof value.maxItems === 'number' && value.minItems > value.maxItems) return null;
    const options: ApprovalResourceOption[] = [];
    for (const option of input.options) {
      if (!record(option) || typeof option.uri !== 'string' || !validFormat(option.uri, 'uri') || typeof option.name !== 'string'
        || option.title !== undefined && typeof option.title !== 'string'
        || option.description != null && typeof option.description !== 'string') return null;
      if (!options.some(existing => existing.uri === option.uri)) options.push({ uri: option.uri, name: option.name,
        ...(typeof option.title === 'string' ? { title: option.title } : {}),
        ...(typeof option.description === 'string' ? { description: option.description } : {}) });
    }
    let userOptions: ApprovalUserOptions | undefined;
    if (input.userOptions !== undefined) {
      if (!record(input.userOptions) || !hasOnly(input.userOptions, ['kind', 'accept'])
        || input.userOptions.kind !== undefined && input.userOptions.kind !== 'file' && input.userOptions.kind !== 'directory'
        || input.userOptions.accept !== undefined && !strings(input.userOptions.accept)) return null;
      userOptions = { ...(input.userOptions.kind === 'file' || input.userOptions.kind === 'directory' ? { kind: input.userOptions.kind } : {}),
        ...(strings(input.userOptions.accept) ? { accept: input.userOptions.accept } : {}) };
    } else if (input.selection === 'implicit') userOptions = {};
    const initial = value.default;
    if (initial !== undefined && (input.selection === 'implicit' || multiple && !strings(initial)
      || !multiple && typeof initial !== 'string'
      || (Array.isArray(initial) ? initial : [initial]).some(uri => !options.some(option => option.uri === uri)))) return null;
    return { ...common, kind: multiple ? 'resources' : 'resource', options, ...(userOptions ? { userOptions } : {}),
      ...(input.selection === 'explicit' || input.selection === 'implicit' ? { selection: input.selection } : {}),
      ...(typeof value.minItems === 'number' ? { minItems: value.minItems } : {}),
      ...(typeof value.maxItems === 'number' ? { maxItems: value.maxItems } : {}),
      ...(typeof initial === 'string' || strings(initial) ? { default: initial } : {}) };
  }
  const base = ['type', 'title', 'description', 'default'];
  if (value.type === 'string' && (value.enum !== undefined || value.oneOf !== undefined)) {
    if (!hasOnly(value, [...base, 'enum', 'enumNames', 'oneOf']) || (value.enum !== undefined && value.oneOf !== undefined)
      || (value.oneOf !== undefined && value.enumNames !== undefined)) return null;
    const options = value.enum !== undefined ? optionsFromEnum(value.enum, value.enumNames) : optionsFromConst(value.oneOf);
    if (!options || (value.default !== undefined && (typeof value.default !== 'string'
      || !options.some((option) => option.value === value.default)))) return null;
    return { ...common, kind: 'select', options, ...(typeof value.default === 'string' ? { default: value.default } : {}) };
  }
  if (value.type === 'string') {
    if (!hasOnly(value, [...base, 'minLength', 'maxLength', 'format'])
      || (value.minLength !== undefined && !count(value.minLength)) || (value.maxLength !== undefined && !count(value.maxLength))
      || (typeof value.minLength === 'number' && typeof value.maxLength === 'number' && value.minLength > value.maxLength)
      || (value.default !== undefined && typeof value.default !== 'string')
      || (value.format !== undefined && (typeof value.format !== 'string'
        || !['email', 'uri', 'date', 'date-time'].includes(value.format)))) return null;
    return { ...common, kind: 'string', ...(typeof value.minLength === 'number' ? { minLength: value.minLength } : {}),
      ...(typeof value.maxLength === 'number' ? { maxLength: value.maxLength } : {}),
      ...(typeof value.format === 'string' ? { format: value.format as 'email' | 'uri' | 'date' | 'date-time' } : {}),
      ...(typeof value.default === 'string' ? { default: value.default } : {}) };
  }
  if (value.type === 'number' || value.type === 'integer') {
    if (!hasOnly(value, [...base, 'minimum', 'maximum'])
      || (value.minimum !== undefined && (typeof value.minimum !== 'number' || !Number.isFinite(value.minimum)))
      || (value.maximum !== undefined && (typeof value.maximum !== 'number' || !Number.isFinite(value.maximum)))
      || (typeof value.minimum === 'number' && typeof value.maximum === 'number' && value.minimum > value.maximum)
      || (value.default !== undefined && (typeof value.default !== 'number' || !Number.isFinite(value.default)))) return null;
    return { ...common, kind: value.type, ...(typeof value.minimum === 'number' ? { minimum: value.minimum } : {}),
      ...(typeof value.maximum === 'number' ? { maximum: value.maximum } : {}),
      ...(typeof value.default === 'number' ? { default: value.default } : {}) };
  }
  if (value.type === 'boolean') {
    if (!hasOnly(value, base) || (value.default !== undefined && typeof value.default !== 'boolean')) return null;
    return { ...common, kind: 'boolean', ...(typeof value.default === 'boolean' ? { default: value.default } : {}) };
  }
  if (value.type === 'array') {
    if (!hasOnly(value, [...base, 'items', 'minItems', 'maxItems']) || !record(value.items)
      || (value.minItems !== undefined && !count(value.minItems)) || (value.maxItems !== undefined && !count(value.maxItems))
      || (typeof value.minItems === 'number' && typeof value.maxItems === 'number' && value.minItems > value.maxItems)) return null;
    const items = value.items;
    const options = hasOnly(items, ['type', 'enum']) && items.type === 'string' ? optionsFromEnum(items.enum)
      : hasOnly(items, ['anyOf']) ? optionsFromConst(items.anyOf) : null;
    if (!options || (value.default !== undefined && (!Array.isArray(value.default)
      || !value.default.every((item) => typeof item === 'string' && options.some((option) => option.value === item))
      || new Set(value.default).size !== value.default.length))) return null;
    return { ...common, kind: 'multi', options, ...(typeof value.minItems === 'number' ? { minItems: value.minItems } : {}),
      ...(typeof value.maxItems === 'number' ? { maxItems: value.maxItems } : {}),
      ...(Array.isArray(value.default) ? { default: value.default as string[] } : {}) };
  }
  return null;
}

/** Accept only the typed MCP form subset whose constraints can be preserved. */
export function parseApprovalForm(value: unknown, mode: FormMode = 'mcp'): FormParse {
  if (!record(value) || !hasOnly(value, ['$schema', 'type', 'properties', 'required', 'title', 'description', 'additionalProperties'])
    || value.type !== 'object' || !record(value.properties)
    || (value.$schema !== undefined && typeof value.$schema !== 'string')
    || (value.title !== undefined && typeof value.title !== 'string')
    || (value.description !== undefined && typeof value.description !== 'string')
    || (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean')
    || (value.required !== undefined && (!Array.isArray(value.required) || !value.required.every((key) => typeof key === 'string')
      || new Set(value.required).size !== value.required.length))) return { error: 'This form schema cannot be represented safely.' };
  const required = value.required as string[] | undefined;
  if (required?.some((key) => !Object.hasOwn(value.properties as object, key))) {
    return { error: 'This form requires an unknown field.' };
  }
  const fields: ApprovalField[] = [];
  for (const [key, field] of Object.entries(value.properties)) {
    const parsed = parseField(key, field, required?.includes(key) ?? false, mode);
    if (!parsed) return { error: 'Unsupported or invalid schema for field: ' + key };
    fields.push(parsed);
  }
  return { form: { fields } };
}

export function initialApprovalValues(form: ApprovalForm): ApprovalFormValues {
  return Object.fromEntries(form.fields.flatMap((field): [string, string | string[]][] => {
    if (field.default === undefined) {
      if (field.required && field.kind === 'string') return [[field.key, '']];
      if (field.required && field.kind === 'multi') return [[field.key, []]];
      if (field.kind === 'resources' && field.selection === 'implicit') return [[field.key, field.options.map(option => option.uri)]];
      if (field.required && field.kind === 'resources') return [[field.key, []]];
      return [];
    }
    return [[field.key, Array.isArray(field.default) ? [...field.default] : String(field.default)]];
  }));
}

function validDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

function validFormat(text: string, format: NonNullable<Extract<ApprovalField, { kind: 'string' }>['format']>): boolean {
  if (format === 'date') return validDate(text);
  if (format === 'email') return /^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(text);
  if (format === 'uri') {
    if (text !== text.trim() || /[\s\u0000-\u001f]/.test(text)) return false;
    try { return Boolean(new URL(text).protocol); } catch { return false; }
  }
  const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(text);
  return Boolean(match && validDate(match[1]!) && Number(match[2]) <= 23 && Number(match[3]) <= 59
    && Number(match[4]) <= 59 && (match[5] === undefined || (Number(match[5]) <= 23 && Number(match[6]) <= 59)));
}

function exactInteger(text: string, value: number): boolean {
  if (!Number.isSafeInteger(value)) return false;
  const unsigned = text.replace(/^[+-]/, '');
  const [mantissa = '', exponentText] = unsigned.toLowerCase().split('e');
  const [whole = '', fractional = ''] = mantissa.split('.');
  let digits = (whole + fractional).replace(/^0+/, '') || '0';
  if (digits === '0') return true;
  const exponent = Number(exponentText ?? '0');
  if (!Number.isSafeInteger(exponent)) return false;
  const shift = exponent - fractional.length;
  if (shift < 0) {
    if (-shift > digits.length || !digits.endsWith('0'.repeat(-shift))) return false;
    digits = digits.slice(0, digits.length + shift) || '0';
  } else {
    if (digits.length + shift > 16) return false;
    digits += '0'.repeat(shift);
  }
  return BigInt((text.startsWith('-') ? '-' : '') + digits) === BigInt(value);
}

export function isApprovalFileUri(value: string): boolean {
  try { const uri = new URL(value); return uri.protocol === 'file:' && !uri.username && !uri.password && Boolean(uri.pathname); }
  catch { return false; }
}

/** Return no partial content when any field fails validation. */
export function validateApprovalForm(form: ApprovalForm, values: ApprovalFormValues): FormValidation {
  const content: Record<string, string | number | boolean | string[]> = Object.create(null) as Record<string, string | number | boolean | string[]>;
  const errors: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const field of form.fields) {
    const value = Object.hasOwn(values, field.key) ? values[field.key] : undefined;
    if (field.kind === 'resource' || field.kind === 'resources') {
      if (value === undefined) {
        if (field.required) errors[field.key] = 'This field is required.';
        continue;
      }
      const selected = field.kind === 'resources' ? value : typeof value === 'string' ? [value] : undefined;
      if (!Array.isArray(selected) || selected.some(item => typeof item !== 'string'
        || !field.options.some(option => option.uri === item) && !(field.userOptions && isApprovalFileUri(item)))
        || new Set(selected).size !== selected.length) errors[field.key] = 'Choose valid resources.';
      else if (field.kind === 'resource' && selected.length !== 1) errors[field.key] = 'Choose a resource.';
      else if (field.minItems !== undefined && selected.length < field.minItems) errors[field.key] = 'Select at least ' + field.minItems + ' options.';
      else if (field.maxItems !== undefined && selected.length > field.maxItems) errors[field.key] = 'Select at most ' + field.maxItems + ' options.';
      else content[field.key] = field.kind === 'resource' ? selected[0]! : selected;
      continue;
    }
    if (field.kind === 'image') {
      if (value === undefined || value === '') {
        if (field.required) errors[field.key] = 'Choose an image.';
      } else if (typeof value !== 'string' || !field.items.some(item => item.id === value)
        && !(field.file && isApprovalFileUri(value))) errors[field.key] = 'Choose a valid image.';
      else content[field.key] = value;
      continue;
    }
    if (field.kind === 'multi') {
      if (value === undefined) {
        if (field.required) errors[field.key] = 'This field is required.';
        continue;
      }
      if (!Array.isArray(value)) { errors[field.key] = 'Choose valid options.'; continue; }
      const selected = value;
      if (selected.some((item) => !field.options.some((option) => option.value === item))
        || new Set(selected).size !== selected.length) errors[field.key] = 'Choose valid options.';
      else if (field.minItems !== undefined && selected.length < field.minItems) errors[field.key] = 'Select at least ' + field.minItems + ' options.';
      else if (field.maxItems !== undefined && selected.length > field.maxItems) errors[field.key] = 'Select at most ' + field.maxItems + ' options.';
      else content[field.key] = selected;
      continue;
    }
    if (typeof value !== 'string') {
      if (value !== undefined) errors[field.key] = 'This field has an invalid value.';
      else if (field.required) errors[field.key] = 'This field is required.';
      continue;
    }
    const text = value;
    if (field.kind === 'select') {
      if (!field.options.some((option) => option.value === text)) errors[field.key] = 'Choose a valid option.';
      else content[field.key] = text;
    } else if (field.kind === 'boolean') {
      if (text !== 'true' && text !== 'false') errors[field.key] = 'Choose true or false.';
      else content[field.key] = text === 'true';
    } else if (field.kind === 'number' || field.kind === 'integer') {
      const number = Number(text);
      const mantissa = text.split(/[eE]/)[0] ?? '';
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) || !Number.isFinite(number)
        || (number === 0 && /[1-9]/.test(mantissa))
        || (field.kind === 'integer' && !exactInteger(text, number))) errors[field.key] = 'Enter a valid ' + field.kind + '.';
      else if (field.minimum !== undefined && number < field.minimum) errors[field.key] = 'Minimum is ' + field.minimum + '.';
      else if (field.maximum !== undefined && number > field.maximum) errors[field.key] = 'Maximum is ' + field.maximum + '.';
      else content[field.key] = number;
    } else if (field.kind === 'string') {
      const length = [...text].length;
      if (field.minLength !== undefined && length < field.minLength) errors[field.key] = 'Enter at least ' + field.minLength + ' characters.';
      else if (field.maxLength !== undefined && length > field.maxLength) errors[field.key] = 'Enter at most ' + field.maxLength + ' characters.';
      else if (field.format && !validFormat(text, field.format)) errors[field.key] = 'Enter a valid ' + field.format + '.';
      else content[field.key] = text;
    }
  }
  return Object.keys(errors).length ? { errors } : { content };
}

export function safeElicitationUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim() || /[\s\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
