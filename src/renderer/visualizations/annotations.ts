export type ControlValue = number | string | boolean;
export interface AnnotationControl {
  type: 'range' | 'color' | 'toggle' | 'select';
  callback: string;
  label: string;
  reference?: unknown;
  currentValue: ControlValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
}
export interface AnnotationTarget { id: string; label: string; selector: string; tagName: string; visible: boolean; rect: { x: number; y: number; width: number; height: number } }
export interface AnnotationRegistration { registrationId: string; controls: AnnotationControl[]; targets: AnnotationTarget[] }
export interface AnnotationEdit { callback: string; previousValue: ControlValue; value: ControlValue }
export interface AnnotationChange { registrationId: string; targetId: string; annotationControlChanges: AnnotationEdit[] }

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validControlValue(control: AnnotationControl, value: unknown): value is ControlValue {
  if (control.type === 'range') return finite(value) && value >= control.min! && value <= control.max!;
  if (control.type === 'color') return typeof value === 'string' && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
  if (control.type === 'toggle') return typeof value === 'boolean';
  return typeof value === 'string' && !!control.options?.some(option => option.value === value);
}

export function parseRegistration(input: unknown): AnnotationRegistration {
  const data = record(input);
  const annotation = record(data.annotationControls);
  if (!bounded(data.registrationId, 80) || annotation.controlsMode !== 'replace' || !Array.isArray(annotation.controls) || annotation.controls.length > 12 ||
      !Array.isArray(data.targets) || data.targets.length < 1 || data.targets.length > 128 || JSON.stringify(annotation).length > 16_384) throw new Error('Invalid annotation registration');
  const controls: AnnotationControl[] = annotation.controls.map((item: unknown) => {
    const value = record(item);
    if (!bounded(value.callback, 80) || !bounded(value.label, 256) || !['range', 'color', 'toggle', 'select'].includes(String(value.type))) throw new Error('Invalid annotation control');
    const control = value as unknown as AnnotationControl;
    if (control.type === 'range' && (!finite(control.min) || !finite(control.max) || control.min >= control.max || !finite(control.step) || control.step <= 0)) throw new Error('Invalid annotation range');
    if (control.type === 'select' && (!Array.isArray(control.options) || control.options.length < 1 || control.options.length > 100 || control.options.some(option => !bounded(option.label, 256) || !bounded(option.value, 256)))) throw new Error('Invalid annotation options');
    if (!validControlValue(control, control.currentValue)) throw new Error('Invalid annotation value');
    return control;
  });
  if (new Set(controls.map(control => control.callback)).size !== controls.length) throw new Error('Duplicate annotation control');
  const targets: AnnotationTarget[] = data.targets.map((item: unknown) => {
    const value = record(item);
    const rect = record(value.rect);
    if (!bounded(value.id, 80) || !bounded(value.label, 80) || !bounded(value.selector, 1024) || !bounded(value.tagName, 80) || !/^[a-z][a-z0-9-]*$/.test(value.tagName) ||
        !finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height) || rect.width < 0 || rect.height < 0 || (value.visible !== undefined && typeof value.visible !== 'boolean')) throw new Error('Invalid annotation target');
    return { id: value.id, label: value.label, selector: value.selector, tagName: value.tagName, visible: value.visible !== false, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  });
  if (new Set(targets.map(target => target.id)).size !== targets.length) throw new Error('Duplicate annotation target');
  return { registrationId: data.registrationId, controls, targets };
}
