# Prisma Motor

PWA para gestionar un taller de mecánica y pintura. Este proyecto está separado de `C:\rmeza\Condominio`.

## Estado actual

- Inicio de sesión y perfiles conectados con Supabase.
- Recepción guarda cliente, vehículo, orden, checklist, novedades, firma y hasta ocho fotos privadas; en celular puedes tomar una foto, volver a tocar el control y seguir agregando. Las fotos se optimizan antes de subirlas.
- Los registros de recepción pueden quedar en una cola local cuando no hay conexión y sincronizarse al volver internet.
- La agenda clasifica las órdenes por estado. Desde el detalle se consultan los datos y se actualiza el historial del flujo.
- La cotización registra conceptos comerciales, incluidos repuestos y pintura/materiales. En una sección aparte, el asesor o propietario crea actividades operativas, asigna oficio y técnico, y define prerequisitos independientes del orden de registro.
- Pintura propone latonería como prerequisito cuando hay tareas de ambos oficios. Mi Bahía muestra qué trabajo debe completarse primero, y Supabase bloquea iniciar o terminar una tarea si sus prerequisitos no están listos.
- El propietario invita al personal desde la Torre de control, registra su especialidad principal (mecánica, latonería o pintura) y puede activar o desactivar el acceso. La persona crea su contraseña al aceptar y luego ingresa a Mi Bahía.
- La lista de personal presenta nombre, correo, especialidad, estado de acceso y sus acciones en una tabla adaptable a móvil. El correo se consulta de forma protegida mediante la Edge Function `create-team-member` (desplegada en Supabase de Prisma Motor el 2026-11-24). Si más adelante cambia esta función, vuelve a desplegarla y recarga la Torre de control.
- La cola de Mi Bahía solo muestra trabajos que el propietario o asesor ya asignó desde el detalle de una orden aprobada.
- Cada tarea de Mi Bahía incluye una ficha de trabajo para consultar la solicitud del cliente, datos de ingreso, checklist, daños y fotos de recepción/diagnóstico. El técnico puede adjuntar fotos con una nota como evidencia de avance; se guardan en el bucket privado de la orden. Esta vista no muestra precios ni permite cambiar el estado de la orden.
- La decisión del cliente define el estado real de la orden: todos los conceptos aprobados → `approved`; aprobación parcial → `partially_approved`; rechazo total → vuelve a `diagnosis`. La asignación y ejecución se registran en tareas aparte, no como subestados de la orden.
- El cliente aprueba o rechaza conceptos y usa el mismo enlace privado para consultar el estado del vehículo, el historial de etapas y el avance de las actividades operativas.
- La Torre de control consulta órdenes reales. En **Finanzas**, el propietario registra pagos y costos internos por hora; el módulo calcula ingresos y costos registrados y margen bruto. El portal privado del cliente muestra pagos y saldo.
- En **Repuestos e insumos**, el inventario por producto, el historial de movimientos y las tarifas por oficio se presentan en tablas que conservan sus columnas en móvil con desplazamiento horizontal táctil o arrastrando con el mouse. Los formularios de alta de producto y registro de movimientos presentan los campos en tablas horizontales compactas; en móvil se desplazan horizontalmente para conservar legibles los controles. El inventario muestra producto/código, tipo, cantidad, unidad, mínimo, estado de existencias, estado del catálogo, costo promedio/base, precio de venta y margen bruto unitario; el historial muestra fecha, producto, tipo, orden/concepto, cantidad, costo unitario, total y nota. El costo es promedio ponderado cuando hay compras; si todavía no existen, puede ser el costo estimado/base del catálogo. El margen unitario es precio de venta menos costo; su porcentaje se calcula sobre el precio de venta y no incluye otros gastos del taller.
- El registro y el listado de costos internos por hora de cada oficio están en la página **Repuestos e insumos**. **Finanzas** conserva los cálculos de margen con esas tarifas y ofrece un acceso para administrarlas.

### Flujo de la orden

`received` → `diagnosis` → `awaiting_approval` → `approved` o `partially_approved` → `awaiting_parts` (si hace falta) → `in_repair` → `quality_control` → `ready_for_delivery` → `delivered`.

Si el cliente rechaza todos los conceptos, la orden vuelve a `diagnosis`. En control de calidad puede volver a reparación. Los estados de tareas (`pending`, `in_progress`, `paused`, `blocked`, `done`) son independientes del estado del vehículo.

## Finanzas y límites actuales

Las finanzas ya registran pagos recibidos, costos de inventario y costo interno por hora, y calculan margen bruto por orden y tipo de servicio con los movimientos registrados. Los consumos pueden asociarse a conceptos aprobados. El margen bruto no es utilidad neta: aún no descuenta gastos generales, impuestos ni costos fijos. Para obtener resultados útiles, registra horas en las tareas, define tarifas por oficio y vincula cada consumo a su concepto.

## Identidad visual acordada

- Azul de marca: `#1E3A8A`
- Gris acero: `#748594` para acentos neutros
- Cobre de acción: `#C66A42` (reservado para acciones principales)
- Fondo claro: `#F8FAFC`
- Técnico: fondo `#0F172A`, tarjetas `#1E293B`, cian `#06B6D4`
- Estados: listo `#10B981`, en proceso `#0EA5E9`, espera `#F59E0B`, urgente `#EF4444`

## Alcance inicial

1. Recepción crea cliente, vehículo y orden.
2. Se registra checklist, firma y fotos privadas.
3. El asesor prepara un presupuesto por ítems.
4. El cliente abre un enlace seguro y aprueba o rechaza cada ítem sin crear cuenta.
5. El personal asignado ve y actualiza sus tareas; los técnicos no consultan precios ni reportes financieros.
6. Recepción comparte manualmente el enlace por WhatsApp.
7. La recepción puede guardarse sin conexión y sincronizarse al volver internet.

## Supabase

- Crear un proyecto independiente para Prisma Motor; no reutilizar el proyecto del Condominio.
- La migración inicial está en `supabase/migrations/20261112000100_initial_schema.sql`.
- La URL del proyecto y la clave publishable están configuradas en `supabase-config.js`; son datos públicos del cliente web, no claves secretas.
- La pantalla de acceso inicia sesión por correo y contraseña, valida el perfil activo y abre la vista correspondiente al rol.
- Para añadir cotizaciones, ejecuta el contenido de `supabase/migrations/20261113000100_client_estimates.sql` en **Supabase → SQL Editor** y pulsa **Run**.
- Luego ejecuta `supabase/migrations/20261113000200_work_order_assignments.sql` y `supabase/migrations/20261113000300_client_tracking.sql`, en ese orden, para habilitar la asignación/cronómetro de tareas y el seguimiento seguro del cliente.
- Ejecuta también `supabase/migrations/20261113000400_team_specialties.sql` para guardar especialidades del equipo. Para enviar invitaciones desde la aplicación, abre PowerShell en esta carpeta y publica la Edge Function `create-team-member` con `npx.cmd supabase login` y `npx.cmd supabase functions deploy create-team-member --remote=fwvkpqlyfrjmgclmvwhj --use-api`.
- Después de aplicar las migraciones existentes hasta `20261113000400_team_specialties.sql`, ejecuta en orden `20261116000100_task_prerequisites.sql`, `20261116000200_order_approval_statuses.sql`, `20261116000300_sync_order_approval_statuses.sql` y `20261116000400_separate_quote_items_from_work_tasks.sql` desde `supabase/migrations`. La aprobación completa y parcial quedarán como estados reales de la orden; el rechazo total la devuelve a diagnóstico. Repuestos y pintura/materiales quedan como conceptos de cotización; solo las actividades reales generan tareas asignables.
- Luego ejecuta `20261117000100_inventory_catalog.sql`. En la Torre de control del propietario abre **Repuestos e insumos** para registrar productos, categoría, unidad, costo y precio. Al cotizar, recepción puede elegir un producto del catálogo o escribir un concepto manual; al guardar un repuesto o insumo manual, se pide su costo estimado y se crea el producto del catálogo sin existencias registradas. El precio del cliente se copia al presupuesto como una instantánea; modificar el catálogo no cambia cotizaciones existentes.
- Ejecuta después `20261117000200_inventory_movements.sql` para activar el historial de bodega. En **Movimientos de inventario**, una compra aumenta existencias y recalcula el costo promedio; un consumo se asocia a una orden, registra el costo y no permite saldo negativo; un ajuste positivo registra el saldo inicial y uno negativo corrige diferencias. El saldo solo cambia mediante esos movimientos: cotizar o aprobar no descuenta inventario.
- Luego ejecuta `20261118000100_owner_financial_dashboard.sql`. En la Torre de control se muestran órdenes reales; en **Finanzas** registra pagos recibidos y el costo interno por hora para cada oficio. Los consumos pueden asociarse con el concepto aprobado que los utiliza. El margen bruto resta esos consumos y el costo de mano de obra del valor de los conceptos aprobados; no equivale a utilidad neta porque aún no registra gastos generales, impuestos ni costos fijos. Para que el margen por servicio sea útil, registra horas en las tareas, define tarifas por oficio y vincula cada consumo a su concepto.
- Después ejecuta `20261118000200_client_portal_payment_summary.sql` para que el enlace privado del cliente muestre los pagos recibidos y el saldo pendiente. En el proyecto Supabase actual de Prisma Motor, ambas migraciones (`20261118000100` y `20261118000200`) están aplicadas y la prueba fue confirmada como correcta el 2026-11-24. Para otros entornos, verifica su estado y aplica las migraciones en orden.
- Después de esas migraciones, ejecuta `20261125000100_fix_inventory_purchase_movement_sign.sql` si las compras de inventario fallan con la restricción `inventory_movements_check`. Corrige la función para registrar la cantidad de compra con signo positivo; verifica luego una compra y el nuevo saldo del producto.
- **Eliminar vehículo y orden** está habilitado solo para el propietario. La migración `20261125000200_delete_work_order_bundle.sql` se aplicó en Supabase de Prisma Motor el 2026-11-25 y se verificó la función. El procedimiento borra los datos dependientes de la orden dentro de una transacción, elimina pagos y consumos asociados, devuelve al saldo actual las unidades consumidas y conserva el vehículo/cliente si comparten otros registros. La interfaz elimina las fotos del bucket con Storage API. La función requiere que el perfil activo sea propietario. En este proyecto, el historial remoto de migraciones de Supabase CLI aparece vacío porque las migraciones anteriores se aplicaron manualmente; no usar `supabase db push` hasta reconciliar ese historial.
- En Supabase → Authentication → URL Configuration, Site URL está configurada como `https://rosameza63.github.io/PrismaMotor/`. Redirect URLs permite tanto `https://rosameza63.github.io/PrismaMotor/**` como `http://localhost:4173/**`, para que funcionen las invitaciones en Pages y las pruebas locales.
- La invitación usa una Edge Function protegida: verifica que quien la solicita sea el propietario activo y usa la clave administrativa solo en el servidor Supabase, nunca en el navegador. La persona invitada activa su acceso desde el correo de Supabase.
- Las cotizaciones usan conceptos manuales en COP, vigencia configurable e impuestos incluidos, agregados o no aplicables. El cliente recibe un enlace privado para aprobar o rechazar cada concepto.
- El enlace usa un token aleatorio; solo se guarda su hash. Funciones SQL seguras validan la vigencia y registran las decisiones, sin exponer la tabla de tokens al cliente.
- En una dirección HTTPS pública, la cotización ofrece compartir el enlace por WhatsApp con un mensaje preparado. El enlace generado mientras la app está en localhost o `file://` solo sirve para pruebas en ese equipo y no se puede abrir desde el teléfono del cliente.
- Fotos y firmas de órdenes usan el bucket privado `order-media` y enlaces temporales firmados para personal autenticado.
- El enlace del cliente permite aprobar la cotización solo hasta la fecha de vigencia; permanece disponible hasta 180 días para consultar el avance del vehículo.
- Para publicar la PWA, el hosting web (por ejemplo GitHub Pages) sirve estos archivos; Supabase continúa como backend y base de datos. El dominio propio se conecta al hosting web, no hace falta configurar un dominio personalizado de Supabase.
- Nunca colocar la clave `service_role` en el navegador ni compartir secretos por chat.
- No aplicar las migraciones de Prisma Motor en el proyecto del Condominio.

## Publicación para pruebas

La PWA está publicada con GitHub Pages en [Prisma Motor](https://rosameza63.github.io/PrismaMotor/). El proyecto Supabase conectado es el de Prisma Motor y la persona confirma que la información existente es de prueba. El sitio muestra una pantalla de inicio de sesión; cada probador necesita una cuenta. El propietario activo puede invitar técnicos desde la app. En móvil, abre el enlace HTTPS y usa la opción del navegador para instalar o agregar a la pantalla de inicio.

## Vista local

Haz doble clic en `Iniciar Prisma Motor.cmd` y abre `http://localhost:4173` en el navegador. El iniciador usa Node.js o el runtime de Codex disponible en el equipo. Deja la ventana abierta mientras usas el prototipo; para detenerlo, presiona `Ctrl+C`.
