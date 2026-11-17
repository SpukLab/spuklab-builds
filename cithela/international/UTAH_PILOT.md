# CITHELA — Utah pilot: seguros + temporada fiscal 2027

Investigación del 15 de noviembre de 2026 · Cliente potencial: profesional en Salt Lake City, Utah, EE. UU.

## Aclaración: naturaleza del trabajo

La profesional atiende clientes vinculados a seguros de auto, vivienda y otros productos; además, en enero y febrero organiza citas relacionadas con declaraciones de impuestos, posibles créditos fiscales y reintegros. **Aún no se verificó** si es preparadora de impuestos registrada, agente de seguros habilitada, asistente comercial, o si trabaja para terceros que realizan los cálculos y la presentación.

No dar por supuesto que tiene autorización legal para declarar impuestos o vender pólizas, ni que su consulta equivale a asesoramiento tributario formal. CITHELA inicialmente **agenda y organiza**, sin calcular impuestos, cotizar primas ni almacenar documentos fiscales.

## Formularios y términos a confirmar con ella

| Documento | Función general |
|---|---|
| **W-2** | Ingresos salariales y retenciones anuales; los empleadores deben emitir el W-2 de 2026 hasta el **1/2/2027** |
| **1099-NEC / 1099-K / otros 1099** | Distintos ingresos independientes, plataformas, intereses o inversiones según el subtipo |
| **1040** | Declaración federal individual, preparada por software/profesional habilitado |
| **TC-40** | Declaración estatal individual de Utah; vencimiento del año fiscal 2026: **15/4/2027** |
| **1095-A** | Cobertura del Marketplace y ajuste del **Premium Tax Credit** si corresponde |
| **1098 / 1098-T** | Intereses hipotecarios o ciertos gastos educativos, según formulario |
| **8867** | Lista de debida diligencia del preparador para beneficios como EITC/CTC/AOTC y otros casos aplicables |

Los «tax credits» podrían referirse a EITC (ingresos laborales), CTC (hijos), AOTC (estudios) o PTC (seguro médico del Marketplace); no inferir cuál usa ni calcular montos sin su confirmación. Los créditos pueden disminuir deuda fiscal y, si son reembolsables, aumentar el reintegro; el resultado final depende de cada declaración.

**Novedad 2026:** el IRS indica que para EITC en declaraciones 2026 puede corresponder un **Schedule 3-A**. Reconfirmar las instrucciones vigentes en 2027.

## Agenda propuesta — implementación mínima

`cithela/international/utah-services.mjs` contiene **seis servicios opcionales**:
- Auto Insurance Quote — 30 min
- Homeowners Insurance Quote — 40 min
- Insurance Policy Review — 25 min
- 2026 Individual Tax Return — Intake — 50 min
- 2026 Tax Documents Review — 25 min
- Tax Credits Eligibility Consultation — 40 min

Los tiempos son **propuestas de configuración**, no reglas fiscales. El importador de servicio no está integrado todavía; no se cambiaron servicios existentes en Supabase.

Por turno almacenar inicialmente solo: categoría, servicio, fecha, horario, nombre/contacto autorizado, canal preferido, consentimiento SMS y etapa administrativa (contactado → agendado → documentación pendiente → listo → completado). El contenido sensible debe quedar en un sistema fiscal especializado con contratos de seguridad adecuados.

Atributos de establecimiento: `en-US` con español optativo, moneda USD, `America/Denver` (con cambio horario verano/invierno), teléfono +1, enlaces SMS neutrales. No confundir `America/Denver` con un huso fijo GMT-7.

## Oportunidad de producto

La temporada fiscal produce picos de llamadas y clientes con papeles incompletos. Diferencial CITHELA: **captar → dar cita → recordar documentos sin recibirlos por SMS → controlar pendientes → registrar seguimiento → reutilizar la agenda para seguros el resto del año**.

MVP sugerido: solo agenda, servicios en inglés, acceso por enlaces SMS manuales, lista informativa de documentos y estado de preparación. Posteriormente SMS empresarial bidireccional con consentimiento y registro A2P 10DLC.

## Límites de cumplimiento y seguridad

1. **IRS PTIN**: si ella prepara federal returns por remuneración, el IRS exige un PTIN 2027 válido; no inferir que lo necesita si solo coordina citas.
2. **Seguro de auto/vivienda**: si vende pólizas, Utah exige licencia de producer para la línea correspondiente. Revisar con Utah Insurance Department.
3. **Protección fiscal**: tax preparers están contemplados por la FTC Safeguards Rule; deben cumplir un programa escrito de seguridad (WISP) y proteger información del contribuyente; proveedores tecnológicos también importan.
4. No pedir, fotografiar ni guardar en CITHELA actual SSN/ITIN, formularios W-2, retornos completos, datos bancarios, pólizas, VIN u otros documentos sensibles antes de una revisión de arquitectura y acuerdos.
5. SMS solo con consentimiento documentado, contenido neutro, identificación del negocio y respeto de exclusiones. Si se automatiza, registrar marca/campaña 10DLC o verificar toll-free y habilitar STOP/HELP; separar marketing de recordatorios.
6. No prometer "calcular el reintegro/credito" dentro de CITHELA; la lógica fiscal cambia cada año y la aplicación no es un motor tributario certificado.

## Fechas verificadas
- **1 de febrero de 2027:** fecha límite W-2 2026 a empleados (en lugar de 31 enero, domingo).
- **15 de abril de 2027:** vencimiento Utah TC-40 para año calendario 2026.
- **Inicio de presentación federal 2027:** no se anuncia fecha definitiva aquí; revisar IRS antes de campañas.
- **EITC/ACTC:** reintegros vinculados a estos créditos no se emiten antes de mediados de febrero por ley; no prometer fecha exacta de devolución.

## Fuentes oficiales
- IRS https://www.irs.gov/instructions/iw2w3
- IRS https://www.irs.gov/individuals/get-ready-to-file-your-taxes
- IRS https://www.irs.gov/tax-professionals/eitc-central/tax-preparer-due-diligence-rules
- IRS https://www.irs.gov/newsroom/irs-security-summit-remind-tax-pros-they-need-a-written-information-security-plan-to-protect-client-data
- Utah https://tax.utah.gov/event/individual-corporate-partnership-income-tax-due-date-jan-dec-2026-2/
- Utah insurance https://insurance.utah.gov/consumers/
- FTC https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know
- Twilio https://help.twilio.com/hc/en-us/articles/11847054539547-A2P-10DLC-Campaign-Approval-Requirements

## Próxima validación con la profesional

Confirmar tres datos en una charla breve: si prepara declaraciones o solo coordina y deriva, qué tipos de seguros comercializa (auto/home/health), y si usa un sistema existente para cálculos/archivo de datos fiscales. Con eso seleccionar servicios y dejar las notificaciones neutrales preparadas para el piloto.
