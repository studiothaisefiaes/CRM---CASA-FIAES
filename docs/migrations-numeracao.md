# Como numerar uma migration

O Drizzle só aplica entradas do `drizzle/meta/_journal.json` com `when` **maior** que o da última migration aplicada no banco. Uma entrada com `when` menor ou igual "sobe com sucesso" e não cria nada (achado C-1 do QA r66).

- As migrations 0062 a 0086 têm `when` no futuro (último: `1792620000000`, 21/10/2026 22:00 UTC). Em produção já estão aplicadas: **não reescreva**.
- A próxima migration (0087 em diante) precisa de `when` **maior que o da entrada anterior do journal** (hoje, maior que `1792620000000`). Some 10 000 000 ms (~2h45) ao último a cada migration nova; só volte a usar `Date.now()` depois que ele passar do último.
- `idx` é sequencial a partir de 0, sem buraco; o nome do arquivo `NNNN_nome.sql` é a `tag`. (O número 0056/0057 não existe no nome, mas o `idx` é contínuo: a tag manda, não o número.)
- Se gerar com `drizzle-kit generate`, confira o `when` gerado (os snapshots em `drizzle/meta` param no 0048; escreva a migration à mão e a entrada do journal).
- Trava: `npm run checar:journal` e `test/journal.test.ts` (rodam no vitest) falham se `idx` ou `when` quebrarem, ou se faltar/sobrar arquivo.
