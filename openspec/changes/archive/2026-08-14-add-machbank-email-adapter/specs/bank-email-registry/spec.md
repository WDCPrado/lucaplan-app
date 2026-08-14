## MODIFIED Requirements

### Requirement: El contrato del parser es común a todos los bancos

Todo parser del catálogo SHALL recibir un mensaje de correo y devolver un evento financiero válido o
un motivo de omisión, con el mismo tipo de resultado para todos los bancos. Ningún parser SHALL
producir un evento de ingreso: del correo solo salen gasto y ajuste de saldo interno.

El instrumento del evento SHALL expresarse en una de tres formas: cuenta corriente por número o
últimos 4, tarjeta de crédito por últimos 4, o **la cuenta principal del vínculo**, sin número.
Esta última existe porque hay bancos cuyas plantillas nombran la cuenta de cargo solo como "tu
cuenta principal": el parser SHALL usarla en vez de inventar un número o de omitir el movimiento, y
la resolución contra los instrumentos confirmados SHALL ocurrir fuera del parser.

#### Scenario: Resultado uniforme
- **WHEN** cualquier parser del catálogo procesa un mensaje
- **THEN** devuelve un evento financiero o un motivo de omisión, sin efectos secundarios ni persistencia

#### Scenario: Ningún banco puede crear un ingreso
- **WHEN** un parser encuentra una entrada de dinero (abono, devolución, reembolso)
- **THEN** la clasifica como ajuste de saldo interno y nunca como ingreso del mes

#### Scenario: La plantilla no numera la cuenta de cargo
- **WHEN** un parser reconoce un cargo cuya plantilla identifica el origen solo como la cuenta principal del banco
- **THEN** emite el evento con la referencia a cuenta principal, sin número de cuenta inventado ni últimos 4 tomados de otro dato del correo
