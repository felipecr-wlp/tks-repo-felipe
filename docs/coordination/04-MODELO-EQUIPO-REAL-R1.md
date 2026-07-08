# WLO / Marketplace: modelo del equipo REAL (post Julio)

Fecha: 2026-07-05. Autor: orquestador (deployer). Fuente de verdad de "cómo trabaja
la gente hoy": dos transcripciones Fathom destiladas en el brain:
- `17_KNOWLEDGE_INGEST/Fathom/Fathom - Julio Offboarding Conocimiento (2026-07-03)`
- `17_KNOWLEDGE_INGEST/Fathom/Fathom - Elite Marketing Team Lead Comercial (2026-06-24)`

Este doc existe porque la especialización WLP del Marketplace y las tareas semilla
NO se pueden sembrar sobre el organigrama viejo. Julio (pieza clave de ventas y
operaciones) se va esta semana (último día martes). El equipo se reacomoda alrededor
de Ismael. Sembrar proyectos/roles con el mapa viejo sería construir sobre humo.

---

## 1. La verdad incómoda: hay DOS poblaciones, no una

El Marketplace parte de una premisa: "antes un jefe repartía, ahora cada quien se
postula". Esa premisa encaja con una parte del equipo y es un error de categoría
con la otra.

### Población A: trabajadores de conocimiento (oficina). SÍ encajan en WLO.
Ya viven en herramientas (Google, Pipedrive, OpenPhone, ChatGPT, Claude, ClickUp,
Vercel), trabajan por proyectos, tienen retros diarias y ciclos de feedback. Aquí el
Marketplace, el CV interno y la calificación tienen sentido.

- **Marketing (Elite Marketing Team):** Agustín (coordina la reunión), Ali
  (cerebro/tech, admin), Felipe (email, landing, tracking), Alan (Google Ads,
  psicología del consumidor), Jorge (SEO, GBP, backlinks), Luis (video).
- **Paving Advisors (ventas):** Ismael (nuevo líder, mano derecha de Julio, ~80% de
  operaciones), Carlos (ingeniero civil, closer agresivo, mejor cierre), Carla
  (súper organizada, hace los Bits grandes, salud sensible: manejar con cuidado).
- **Admin y legal:** Elizabeth (legal, 90% del plato legal), Lili (aseguranzas,
  administración, payroll, tickets, safety).

### Población B: la cuadrilla de campo (~8). NO encajan en el modelo self-apply.
Son laboristas de campo: onboarding en papel (paquete de 40+ páginas que llenan en
casa), jerarquía de mando dura ("el equipo no habla con nadie que no sea Julio o
Ismael"), no tocan software. Pedirle a Don José (65 años, groundwork) que "se postule
a un proyecto" no va a pasar.

- Don José (el corazón, groundwork camino a supervisor), Miguel, Cristian, Joel,
  Andrés, Octavio, José Luis Zaragoza, Juan (CDL), Jesús.

**Regla de rollout que se desprende:** el Marketplace y la calificación anónima se
lanzan SOLO a la población A. La cuadrilla de campo se queda fuera del self-apply en
el arranque. Si algún día entran, es con otro modelo (supervisor captura por ellos,
no auto-postulación).

---

## 2. Por qué construir WLO AHORA (el argumento más fuerte lo dio la salida de Julio)

La entrevista de offboarding dejó tres huecos que son exactamente lo que un sistema
como WLO resuelve:

1. **Riesgo de persona clave, ya materializado.** Todo el conocimiento de ventas y
   operaciones vivía en la cabeza de Julio. Se va y Ismael sabe ~80%. Sin un sistema
   que capture quién hace qué y cómo, la próxima salida vuelve a doler.
2. **Documentación casi nula.** "No hay reportes escritos formales, casi todo son
   videos y fotos en Google y redes." La forma real de documentar en WLP es
   fotográfica y de video, no texto.
3. **Falta de accountability.** Lo poco que Julio criticó del negocio: falta de
   rendición de cuentas, comunicación y no valorar/pagar a tiempo (rotación por
   sueldos 10 a 20 dólares mayores en otras compañías).

**Implicación de prioridad para las 3 conversaciones (A/B/C):** el valor cercano de
WLO no es el calendario ni el timer bonito. Es (a) claridad de propiedad (quién es
dueño de qué tras el reacomodo) y (b) documentación que embone con cómo documentan de
verdad: **fotos y videos**. Eso mueve el peso hacia los adjuntos de Conv B
(`task_attachments`) como la pieza de mayor retorno, no como un extra.

---

## 3. Mapa propuesto: personas por área del Marketplace y líder

Las 8 áreas son las de `spec-wlp-marketplace.md`. Los líderes marcados con warning
son recomendación mía, NO confirmados: es decisión de personas de Ali. No se siembran
en la base hasta que Ali confirme cada uno.

| Área (slug ASCII) | Nombre visible | Líder propuesto | Miembros naturales | Nota de realidad |
|---|---|---|---|---|
| operaciones_obra | Operaciones de obra | Ismael (warning) | cuadrilla via supervisor | La cuadrilla NO se auto postula; Ismael captura por ellos |
| estimacion_ventas | Estimación y ventas | Ismael o Carlos (warning) | Carlos, Carla | Split sugerido por Julio: Sales Manager vs Ejecución |
| marketing | Marketing | Agustín (warning) | Felipe, Alan, Jorge, Luis | Único equipo con retro diaria ya viva |
| finanzas | Finanzas | Fred / Lili (warning) | Lili (payroll) | Payroll y prevailing wages son dolor real de Lili |
| seguridad_cumplimiento | Seguridad y cumplimiento | sin dueño (warning) | Ismael, Elizabeth, Lili | HUECO real: nadie es responsable de OSHA/PPE hoy |
| sistemas_datos | Sistemas y datos | Ali (warning) | Alan | El cerebro/Kern vive aquí |
| personas_cultura | Personas y cultura | Lili / Elizabeth (warning) | Elizabeth | Onboarding en papel, clausula de salud pendiente |
| flota_activos | Flota y activos | Alan / Ismael (warning) | Alan | Inventario de maquinaria lo empezó Alan |

Notas duras del terreno que cambian el diseño:
- **Solo hay 2 advisors fijos** (Carlos y Carla) disponibles para llamadas; Ismael y
  Julio están en obra. Cualquier proyecto que asuma "5 vendedores libres" es irreal.
- **Seguridad/cumplimiento no tiene dueño.** Si el Marketplace lo publica como proyecto
  con líder, hay que asignar uno de verdad (Ismael o Elizabeth), no un placeholder.
- **La salud de Carla es sensible.** No cargarla de proyectos ni exponerla en tableros
  de "capacidad". Tratar con confidencialidad.

---

## 4. Qué NO tocar y qué queda pendiente de Ali

Pendiente de confirmación de Ali antes de sembrar en Supabase:
1. Los 8 líderes de arriba (decisión de personas, no de código).
2. Si el arranque del Marketplace excluye formalmente a la cuadrilla de campo (mi
   recomendación: sí).
3. Si Estimación y ventas se parte en dos proyectos (Sales vs Ejecución) como sugirió
   Julio, o queda uno solo con Ismael de líder al inicio.

Este doc es aditivo: no toca archivos de Conv A/B/C. Es el input de realidad para las
tareas semilla y la config de roles del Marketplace.
