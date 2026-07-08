# Skill: Ver Spec del Proyecto

Muestra un resumen del estado actual del spec técnico y las decisiones bloqueadas del proyecto Work OS.

## Al invocar /spec, muestra:

1. **Stack bloqueado** (del CLAUDE.md)
2. **Jerarquía de datos**
3. **Estado de fases** (qué está hecho, qué falta)
4. **Últimas decisiones tomadas**
5. **Próximo paso de desarrollo**

## Instrucción

Lee `CLAUDE.md` en la raíz del proyecto y muestra la información organizada.
Si hay archivos en `supabase/migrations/`, lista las migraciones existentes.
Si hay archivos en `src/`, muestra el árbol de estructura actual.

Termina indicando: "**Próximo paso:** [acción específica a tomar]"
