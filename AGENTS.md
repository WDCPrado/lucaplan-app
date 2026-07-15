<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Orquestación Codex → Claude Code

Codex investiga, define el alcance, crea o actualiza OpenSpec y revisa el resultado. Claude Code
solo implementa después de que el usuario apruebe explícitamente el OpenSpec.

## Invocación única y efímera

- No consultar a Claude en `--permission-mode plan`; OpenSpec ya es el plan y contrato.
- Ejecutar como máximo una invocación de Claude a la vez. Nunca usar `--background`, `--continue`,
  `--resume`, `--fork-session`, worktrees ni subagentes.
- Toda invocación MUST usar `-p`, `--no-session-persistence` y `--safe-mode` para no guardar una
  conversación ni levantar plugins/MCP. Como `--safe-mode` desactiva el autodescubrimiento, el
  prompt MUST ordenar leer `CLAUDE.md` y el OpenSpec aplicable antes de editar.
- Implementación aprobada:

  ```powershell
  claude -p "Lee CLAUDE.md y el OpenSpec <change-id>; impleméntalo y verifica" `
    --permission-mode acceptEdits --output-format json `
    --no-session-persistence --safe-mode
  ```

- Esperar a que la invocación termine y revisar `git diff` antes de pedir una corrección. Una
  corrección, si hace falta, es otra invocación efímera y secuencial, nunca una sesión paralela.
- No confiar solo en el timeout del shell: si Claude expira, falla o se interrumpe, terminar su árbol
  de procesos y cualquier MCP hijo creado por esa ejecución. Verificar que no quede ningún proceso
  nuevo; no tocar procesos que ya pertenecían al usuario.
- Si una invocación falla, diagnosticar la causa antes de reintentar. No crear varias sesiones para
  probar el mismo prompt.

Claude no hace commit/push, no instala dependencias, no toca secretos o `.env`, no despliega ni
ejecuta cambios destructivos sin autorización explícita. Codex conserva la decisión final y valida
tests, lint, tipos y build aplicables.
