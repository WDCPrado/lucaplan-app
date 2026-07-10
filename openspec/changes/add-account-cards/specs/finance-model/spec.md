## ADDED Requirements

### Requirement: Número de tarjeta de la cuenta

La cuenta SHALL almacenar los **últimos 4 dígitos** de su tarjeta (`cardLast4`) cuando su tipo
tiene tarjeta; NUNCA el número completo. `cardLast4` MUST ser obligatorio para los tipos con
tarjeta (`checking` = tarjeta de débito, `credit_card` = tarjeta de crédito) y SHALL quedar
nulo/ausente para los tipos sin tarjeta (`savings`, `wallet`). El valor persistido MUST ser
exactamente 4 dígitos numéricos.

#### Scenario: Cuenta corriente exige últimos 4 dígitos
- **WHEN** se crea una cuenta corriente (`checking`) sin los últimos 4 dígitos
- **THEN** la creación falla con un error de validación (los 4 dígitos son obligatorios)

#### Scenario: Cuenta de ahorro sin tarjeta
- **WHEN** se crea una cuenta de ahorro (`savings`)
- **THEN** no se pide ni se guarda `cardLast4` (queda nulo)

#### Scenario: Solo se guardan 4 dígitos
- **WHEN** se ingresa el número de una tarjeta
- **THEN** solo se persisten los últimos 4 dígitos, y son exactamente 4 dígitos numéricos
