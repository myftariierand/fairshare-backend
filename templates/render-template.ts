// email-templates/render-template.ts
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

export function renderTemplate(
  templateName: string,
  context: Record<string, any>,
): string {
  const templatePath = path.join(
    process.cwd(),
    'templates',
    `${templateName}.hbs`,
  );
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  const template = Handlebars.compile(templateSource);
  return template(context);
}
