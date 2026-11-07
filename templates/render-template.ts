// email-templates/render-template.ts
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

// The files never change while the app runs, so each is read and compiled once
const compiled = new Map<string, Handlebars.TemplateDelegate>();

export function renderTemplate(
  templateName: string,
  context: Record<string, any>,
): string {
  let template = compiled.get(templateName);

  if (!template) {
    const templatePath = path.join(
      process.cwd(),
      'templates',
      `${templateName}.hbs`,
    );

    template = Handlebars.compile(fs.readFileSync(templatePath, 'utf8'));
    compiled.set(templateName, template);
  }

  return template(context);
}
