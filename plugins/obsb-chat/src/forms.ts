import { type FormAnswer, type FormField, type FormValue, type SessionForm } from './protocol';

type Control = { field: FormField; row: HTMLElement; read: () => FormValue | undefined };
export class FormCards {
  private cards = new Map<string, { signature: string; el: HTMLElement }>();
  private settled = new Set<string>();
  constructor(private parent: HTMLElement, private reply: (form: SessionForm, answer?: FormAnswer) => Promise<void>) {}
  clear(): void { this.cards.clear(); this.settled.clear(); this.parent.empty(); }
  update(forms: SessionForm[]): void {
    forms = forms.filter(form => !this.settled.has(form.id));
    const ids = new Set(forms.map(form => form.id));
    for (const [id, card] of this.cards) if (!ids.has(id)) { card.el.remove(); this.cards.delete(id); }
    for (const form of forms) {
      const signature = JSON.stringify(form); const previous = this.cards.get(form.id);
      if (previous?.signature === signature) continue;
      previous?.el.remove();
      const el = this.parent.createDiv('obsb-form-card');
      this.cards.set(form.id, { signature, el }); this.render(el, form);
    }
  }
  private render(el: HTMLElement, form: SessionForm): void {
    el.createEl('strong', { text: form.title || 'AI 需要你的回答' });
    const body = el.createEl('form'); const controls: Control[] = [];
    let unsupported = false;
    for (const field of form.fields) {
      const row = body.createDiv('obsb-form-field');
      const label = row.createEl('label', { text: (field.title || field.key) + (field.required ? ' *' : '') });
      if (field.description) row.createDiv({ text: field.description, cls: 'obsb-form-description' });
      let read: Control['read'];
      if (field.type === 'string' && !field.options?.length) {
        const input = row.createEl('textarea', { attr: { rows: '2', placeholder: field.placeholder || '填写回答', 'aria-label': field.title || field.key } });
        input.value = typeof field.default === 'string' ? field.default : '';
        read = () => input.value.trim() || undefined;
      } else if (field.type === 'string' || field.type === 'multiselect') {
        const options: HTMLInputElement[] = []; const multiple = field.type === 'multiselect';
        for (const option of field.options ?? []) {
          const choice = row.createEl('label', { cls: 'obsb-form-option' });
          const input = choice.createEl('input', { attr: { type: multiple ? 'checkbox' : 'radio', name: form.id + ':' + field.key, value: option.value } });
          input.checked = multiple ? Array.isArray(field.default) && field.default.includes(option.value) : field.default === option.value;
          choice.createSpan({ text: option.label });
          if (option.description) choice.createSpan({ text: option.description, cls: 'obsb-form-description' });
          options.push(input);
        }
        const custom = field.custom ? row.createEl('textarea', { attr: { rows: '2', placeholder: multiple ? '其他回答，每行一项（可与选项一起提交）' : '或输入自己的回答', 'aria-label': (field.title || field.key) + '：其他回答' } }) : undefined;
        if (custom && typeof field.default === 'string' && !field.options?.some(option => option.value === field.default)) custom.value = field.default;
        if (custom && Array.isArray(field.default)) custom.value = field.default.filter(value => !field.options?.some(option => option.value === value)).join('\n');
        read = () => {
          const selected = options.filter(input => input.checked).map(input => input.value);
          if (multiple) return [...new Set([...selected, ...(custom?.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean) ?? [])])];
          return custom?.value.trim() || selected[0];
        };
      } else if (field.type === 'boolean') {
        const input = row.createEl('select', { attr: { 'aria-label': field.title || field.key } });
        for (const [value, text] of [['', '请选择…'], ['true', '是'], ['false', '否']]) input.createEl('option', { value, text });
        input.value = typeof field.default === 'boolean' ? String(field.default) : '';
        read = () => input.value ? input.value === 'true' : undefined;
      } else if (field.type === 'number' || field.type === 'integer') {
        const input = row.createEl('input', { attr: { type: 'number', step: field.type === 'integer' ? '1' : 'any', 'aria-label': field.title || field.key } });
        if (typeof field.default === 'number') input.value = String(field.default);
        read = () => input.value === '' ? undefined : Number(input.value);
      } else {
        unsupported = true;
        row.createDiv({ text: '此表单包含暂不支持的字段，请在 OpenCode 网页继续回答。', cls: 'obsb-error' });
        read = () => undefined;
      }
      // The first ordinary input is labelled; option inputs have wrapping labels.
      const input = row.querySelector('textarea, select, input');
      if (input) { input.id = form.id + ':' + field.key; label.htmlFor = input.id; }
      controls.push({ field, row, read });
    }
    const enabled = (field: FormField, values: FormAnswer) => (field.when ?? []).every(condition => condition.op === 'eq' ? values[condition.key] === condition.value : values[condition.key] !== condition.value);
    const answer = (): FormAnswer => {
      const values: FormAnswer = Object.fromEntries(controls.flatMap(control => {
        const value = control.field.hidden ? control.field.default : control.read(); return value === undefined ? [] : [[control.field.key, value]];
      }));
      // Disabled conditional fields must not enable dependent fields through
      // stale input that is no longer part of the submitted answer.
      for (let pass = 0; pass < controls.length; pass++) {
        let changed = false;
        for (const { field } of controls) if (field.key in values && !enabled(field, values)) { delete values[field.key]; changed = true; }
        if (!changed) break;
      }
      return values;
    };
    const update = () => {
      const values = answer();
      for (const { field, row } of controls) row.hidden = !!field.hidden || !enabled(field, values);
    };
    body.addEventListener('input', update); body.addEventListener('change', update); update();
    const error = body.createDiv('obsb-error'); error.setAttribute('role', 'alert');
    const actions = body.createDiv('obsb-actions');
    const submit = actions.createEl('button', { text: '提交回答', cls: 'mod-cta', attr: { type: 'submit' } }); submit.disabled = unsupported;
    const cancel = actions.createEl('button', { text: '取消提问', attr: { type: 'button' } });
    let busy = false;
    const send = async (reject: boolean) => {
      if (busy) return;
      error.empty();
      if (!reject && unsupported) { error.setText('此表单包含暂不支持的字段，请在 OpenCode 网页继续回答。'); return; }
      const values = answer(); const result: FormAnswer = {};
      try {
        if (!reject) for (const { field } of controls) {
          if (!enabled(field, values)) continue;
          const value = field.hidden ? field.default : values[field.key];
          validateField(field, value);
          if (value !== undefined) result[field.key] = value;
        }
        busy = true; submit.disabled = true; cancel.disabled = true;
        await this.reply(form, reject ? undefined : result);
        this.settled.add(form.id); this.cards.get(form.id)?.el.remove(); this.cards.delete(form.id);
      } catch (reason) { error.setText(reason instanceof Error ? reason.message : '提交失败，请重试'); }
      finally { busy = false; submit.disabled = unsupported; cancel.disabled = false; }
    };
    body.addEventListener('submit', event => { event.preventDefault(); void send(false); });
    cancel.addEventListener('click', () => { void send(true); });
  }
}

function validateField(field: FormField, value: FormValue | undefined): void {
  const title = field.title || field.key;
  if (value === undefined || value === '' || Array.isArray(value) && !value.length) {
    if (field.required || field.type === 'multiselect' && (field.minItems ?? 0) > 0) throw new Error(`请回答“${title}”`);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || field.type === 'integer' && !Number.isInteger(value)) throw new Error(`“${title}”需要有效${field.type === 'integer' ? '整数' : '数字'}`);
    if (typeof field.minimum === 'number' && value < field.minimum || typeof field.maximum === 'number' && value > field.maximum) throw new Error(`“${title}”超出允许范围`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (length < (field.minLength ?? 0) || length > (field.maxLength ?? Infinity)) throw new Error(`“${title}”长度不符合要求`);
    if (field.pattern && !new RegExp(field.pattern).test(value)) throw new Error(`“${title}”格式不符合要求`);
    if (field.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`“${title}”需要邮箱地址`);
    if (field.format === 'uri') { try { new URL(value); } catch { throw new Error(`“${title}”需要完整链接`); } }
    if (field.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value) || field.format === 'date-time' && !Number.isFinite(Date.parse(value))) throw new Error(`“${title}”需要有效日期`);
  }
  if (Array.isArray(value) && (value.length < (field.minItems ?? 0) || value.length > (field.maxItems ?? Infinity))) throw new Error(`“${title}”选项数量不符合要求`);
}
