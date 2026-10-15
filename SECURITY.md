# Security policy

## Supported versions

Security fixes go into the latest published version.

## Reporting a vulnerability

Please do not open a public issue. Email **sales.bydtech@gmail.com** with
"og-cards security" in the subject, a description of the problem, and steps
to reproduce it. You will get an acknowledgment, and a fix or a decision
will be shared with you before anything is disclosed publicly.

## What this tool trusts

`og-cards` imports your config file and runs it as code, and it renders your
templates in a real browser with JavaScript enabled. Treat the config, the
templates and the card data like any other build script. Card fields are
HTML-escaped in `{{field}}` placeholders and by `escapeHtml`; `{{{field}}}`
and unescaped template-function output are inserted as is.

Card pages can load files only from the template's directory; requests that
would leave it are refused. Captures open whatever URLs the config names.
