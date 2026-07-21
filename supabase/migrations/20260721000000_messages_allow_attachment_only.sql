-- Permite enviar mensajes de chat de equipo que solo llevan adjunto (body vacio).
--
-- Bug: el chip del archivo aparecia (subida al bucket chat-files OK) pero al
-- enviar sin texto, POST /api/messages devolvia 500 y el toast "No se pudo
-- enviar el mensaje". Causa: el CHECK viejo exigia char_length(body) >= 1, pero
-- la API ya acepta body vacio si hay al menos un adjunto (schema .refine).
--
-- Fix aditivo y seguro: se afloja el CHECK para permitir body vacio cuando
-- attachments es un array con al menos un elemento. No rompe filas existentes
-- (todas tienen body >= 1) y mantiene el tope de 4000 caracteres.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_body_check CHECK (
  char_length(body) <= 4000
  AND (
    char_length(body) >= 1
    OR (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) >= 1)
  )
);
