-- Replace existing icebreaker templates with 4 new tones
-- Each template has tone-specific instructions that get combined with auto-injected context

-- First, deactivate all existing templates
UPDATE icebreaker_templates SET is_active = false;

-- Delete old templates to start fresh
DELETE FROM icebreaker_templates;

-- Insert 4 new tone templates
INSERT INTO icebreaker_templates (name, description, tone, prompt_template, is_active) VALUES
(
  'Insight de Industria',
  'Liderar con una observacion o tendencia relevante de la industria del prospecto. Posiciona al vendedor como alguien que entiende el sector.',
  'industry_insight',
  'ESTILO: Conversacional, informado, curioso.
ENFOQUE: Liderar con una observacion o tendencia relevante de la industria del prospecto. NO vendas. Demostra que entendes su sector.

LINKEDIN (max 300 caracteres):
- Abri con una observacion sobre su industria o una tendencia que afecta su rol
- Conectalo con su empresa y posicion
- Cerra con una pregunta abierta de curiosidad (NO pidas reunion ni ofrezcas servicios)
- Ejemplo de cierre: "Me genera curiosidad como lo estan abordando" o "Que perspectiva tenes sobre esto?"

EMAIL DE SEGUIMIENTO (max 150 palabras):
- Referencia el mensaje de LinkedIn
- Desarrolla el insight de industria con un dato concreto o aprendizaje de un caso similar (usa los DOCs disponibles si hay)
- Conecta el aprendizaje con un desafio probable de su empresa
- Ofrece compartir el caso/aprendizaje sin pedir nada a cambio
- Cierre tipo: "Te paso el detalle si te sirve" o "Feliz de compartirlo si te interesa"',
  true
),
(
  'Referencia a Caso Real',
  'Mencionar un caso de exito especifico que sea relevante para la industria o tecnologia del prospecto. Hablar de desafios y resultados.',
  'case_reference',
  'ESTILO: Concreto, orientado a resultados, peer-to-peer.
ENFOQUE: Mencionar un caso de exito especifico (de los DOCs si hay) que sea relevante. Hablar de desafios y resultados, no de productos.

LINKEDIN (max 300 caracteres):
- Menciona brevemente un desafio que resolvieron (no digas "nuestro cliente", usa el contexto del caso)
- Conectalo con algo especifico de su empresa o rol
- Pregunta si enfrentan algo similar
- Ejemplo: "Resolvimos [desafio] en [sector similar]. Me pregunto si en [empresa] enfrentan algo parecido?"

EMAIL DE SEGUIMIENTO (max 150 palabras):
- Referencia el mensaje de LinkedIn
- Desarrolla el caso con contexto: que desafio tenia la empresa, que se hizo, que resultados concretos se obtuvieron
- Explica por que crees que es relevante para SU empresa especificamente (conecta con sus tecnologias/procesos)
- Ofrece compartir mas detalles del caso',
  true
),
(
  'Pregunta Consultiva',
  'Zero pitch. Pura curiosidad profesional. Pedir la perspectiva del prospecto sobre un tema de su expertise.',
  'consultive',
  'ESTILO: Genuinamente curioso, humilde, intelectual. ZERO pitch.
ENFOQUE: Hacer una pregunta real sobre un desafio de su rol/industria. Posicionar al vendedor como alguien que quiere aprender, no vender.

LINKEDIN (max 300 caracteres):
- Formula una pregunta genuina sobre un desafio tecnico o de negocio de su rol
- Muestra que entendes la complejidad (no hagas preguntas basicas)
- Invita a compartir su perspectiva
- Ejemplo de cierre: "Estarias abierto a compartir tu experiencia?" o "Me encantaria escuchar tu perspectiva"

EMAIL DE SEGUIMIENTO (max 150 palabras):
- Referencia el mensaje de LinkedIn
- Profundiza la pregunta con mas contexto (menciona tendencias o desafios especificos del sector)
- Comparte una perspectiva propia breve (basada en experiencia) para mostrar que es un intercambio, no un interrogatorio
- Propone un intercambio de conocimiento informal (cafe virtual)',
  true
),
(
  'Conexion Directa',
  'Transparente y conciso. Sin rodeos pero respetuoso. Para prospectos donde hay senales claras de necesidad.',
  'direct',
  'ESTILO: Transparente, profesional, conciso. Sin rodeos pero respetuoso.
ENFOQUE: Ser directo sobre el motivo del contacto. Para prospectos con senales claras (tecnologias matcheadas, necesidad evidente).

LINKEDIN (max 300 caracteres):
- Se transparente sobre por que te contactas
- Conecta con una necesidad concreta basada en las senales detectadas
- Propone un paso concreto y breve
- Ejemplo: "Vi que en [empresa] trabajan con [tecnologia]. Nos especializamos en [area relevante]. Te puedo contar en 10 min como ayudamos a [referencia]?"

EMAIL DE SEGUIMIENTO (max 150 palabras):
- Referencia el mensaje de LinkedIn
- Refuerza la propuesta de valor con evidencia concreta (caso de exito + resultado numerico si existe)
- Explica en 2-3 lineas que haces especificamente y como se conecta con su empresa
- CTA claro: reunion de 15 min, demo, o compartir caso',
  true
);
