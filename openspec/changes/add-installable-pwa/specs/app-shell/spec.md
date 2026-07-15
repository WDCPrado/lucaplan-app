## ADDED Requirements

### Requirement: Shell compatible con safe areas
El shell autenticado SHALL adaptar sus superficies superiores, contenido y acciones fijas a las safe areas del dispositivo cuando la aplicación corre en modo standalone. Los controles MUST mantener un objetivo táctil de al menos 44px y MUST NOT quedar debajo del notch, Dynamic Island o home indicator.

#### Scenario: Acciones móviles en iPhone instalado
- **WHEN** el dashboard corre como web app instalada en un iPhone con safe areas no nulas
- **THEN** selector de mes, perfil y FAB quedan visibles, alcanzables y separados de las áreas reservadas del sistema

#### Scenario: Shell de escritorio no cambia
- **WHEN** el dashboard corre en escritorio o como pestaña normal
- **THEN** conserva el layout y espaciado definidos por la especificación existente

### Requirement: Acción de instalación no intrusiva
El shell SHALL ubicar “Instalar Luca Plan” dentro de la zona de usuario existente y SHALL reutilizar las superficies adaptativas del proyecto para cualquier instrucción. La acción MUST NOT sustituir navegación, CTA financieros ni controles primarios.

#### Scenario: Instalación desde el menú de usuario
- **WHEN** la app es instalable y el usuario abre su menú
- **THEN** encuentra una única acción “Instalar Luca Plan” junto a las acciones secundarias de perfil y tema

#### Scenario: Estado no instalable
- **WHEN** el navegador no permite iniciar instalación ni corresponde mostrar instrucciones iOS
- **THEN** el shell omite la acción sin dejar un control inerte

