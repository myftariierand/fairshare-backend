// email-templates/render-template.ts
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

const handlebars = Handlebars.create();

// The files never change while the app runs, so each is read and compiled once
const compiled = new Map<string, Handlebars.TemplateDelegate>();
let partialsRegistered = false;

const templatePath = (...file: string[]) =>
  path.join(process.cwd(), 'templates', ...file);

const registerPartials = () => {
  if (partialsRegistered) return;

  for (const file of fs.readdirSync(templatePath('partials'))) {
    handlebars.registerPartial(
      path.basename(file, '.hbs'),
      fs.readFileSync(templatePath('partials', file), 'utf8'),
    );
  }

  partialsRegistered = true;
};

const render = (
  file: string,
  context: Record<string, any>,
  options?: CompileOptions,
) => {
  registerPartials();

  let template = compiled.get(file);

  if (!template) {
    template = handlebars.compile(
      fs.readFileSync(templatePath(file), 'utf8'),
      options,
    );
    compiled.set(file, template);
  }

  return template(context);
};

export const renderTemplate = (
  templateName: string,
  context: Record<string, any>,
): string => render(`${templateName}.hbs`, context);

// Not escaped, because nothing reads this as HTML. A reset link's "=" would otherwise arrive as "&#x3D;".
export const renderTextTemplate = (
  templateName: string,
  context: Record<string, any>,
): string => render(`${templateName}.txt.hbs`, context, { noEscape: true });
