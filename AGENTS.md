# AGENTS.md

Este projeto segue o contrato funcional descrito em [RCF.md](RCF.md).

Ao alterar o sistema:

- Preserve `main.js` como ponto de execução principal e RCF operacional.
- Mantenha a lógica de negócio em `src/`, evitando alterações diretas em `node_modules/`.
- Atualize [RCF.md](RCF.md) quando uma regra funcional ou não funcional mudar.
- Mantenha compatibilidade com CLI sempre que adicionar novas entradas pela GUI.
- Rode `npm test` e `npm run check` quando a mudança tocar parser, template, CSV, anexos, browser, GUI ou envio.
- Não altere `clientes.csv`, `texto.md` ou arquivos reais do usuário durante validação ou teste.
