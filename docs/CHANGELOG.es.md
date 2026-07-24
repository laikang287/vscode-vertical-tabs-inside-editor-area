# Registro de cambios

[English](CHANGELOG.md) · [简体中文（规范源）](CHANGELOG.zh-CN.md) · [繁體中文](docs/CHANGELOG.zh-TW.md) · [日本語](docs/CHANGELOG.ja.md) · [한국어](docs/CHANGELOG.ko.md) · [Español](docs/CHANGELOG.es.md) · [Français](docs/CHANGELOG.fr.md) · [Deutsch](docs/CHANGELOG.de.md) · [Русский](docs/CHANGELOG.ru.md)

## [1.0.0] - 2026-07-23

<mark>Esta es una actualización importante. Debido al gran número de cambios, considera volver a la versión 0.2.1 si encuentras errores.</mark>

### Funciones destacadas

- <mark>El menú contextual de las pestañas verticales puede mostrar todos los botones disponibles en las pestañas horizontales de VS Code, incluidos los de VS Code y los aportados por extensiones de terceros.</mark>
- Se actualizó el estilo de la interfaz para adaptarlo mejor a los temas de VS Code.
- Se añadió la posibilidad de guardar y cargar conjuntos de trabajo.
- Las pestañas verticales pueden colocarse a la izquierda o a la derecha.
- Se mejoró la función de búsqueda.
- Se añadió la opción `verticalTabs.relativePathDisplay`, que controla cuándo se muestra una ruta en la pestaña; por ejemplo, se puede mostrar el directorio contenedor solo en archivos con el mismo nombre.
- Se añadieron varios atajos configurables para cambiar y mover pestañas, entre otras operaciones.
    - Consulta las descripciones de los atajos de teclado para obtener más información.
    - No hay atajos asignados de forma predeterminada; asígnalos según tus necesidades.
    - `verticalTabs.previousAcrossGroups` y `verticalTabs.nextAcrossGroups` cambian a la pestaña anterior o siguiente entre grupos. <mark>Estos dos comandos se utilizan con mucha frecuencia. Se recomienda asignarlos a `Ctrl+Tab` y `Ctrl+Shift+Tab`, sustituyendo los atajos predeterminados de VS Code.</mark>
- Se añadieron varias opciones de configuración; consulta sus descripciones para obtener más información.

### Integración con el menú contextual nativo de VS Code

- El menú contextual de una pestaña ahora puede mostrar las acciones que VS Code y otras extensiones registran en el menú nativo de pestañas del editor.
- Se añadió `verticalTabs.showNativeContextMenuActions` para controlar si se habilitan las acciones del menú contextual nativo de VS Code. Está habilitado de forma predeterminada.
- Los submenús nativos se pueden abrir y utilizar con el teclado.
- Nota:

### Búsqueda y localización de pestañas

- Se añadió una búsqueda de pestañas en tiempo real que permite filtrar por nombre.
- Se puede incluir la ruta relativa al área de trabajo en la búsqueda y mostrar y resaltar las rutas coincidentes en los resultados.
- Se admiten búsquedas mediante expresiones regulares. Una expresión no válida muestra un error sin alterar la lista actual.
- Se muestra el número de pestañas y grupos coincidentes, y se resalta el texto encontrado.
- Durante la búsqueda se expanden automáticamente los grupos que contienen resultados; al borrar la búsqueda se restaura su estado de contracción anterior.

### Visualización de rutas y distinción de archivos con el mismo nombre

La opción `verticalTabs.relativePathDisplay` ofrece finalmente cinco modos:

- No mostrar rutas.
- Mostrar el directorio contenedor solo en archivos con el mismo nombre.
- Mostrar la ruta relativa al área de trabajo solo en archivos con el mismo nombre.
- Mostrar siempre el directorio contenedor en todos los archivos.
- Mostrar siempre la ruta relativa al área de trabajo en todos los archivos.

La ruta aparece debajo del nombre de la pestaña. Los archivos de la raíz del área de trabajo y los archivos externos utilizan información reconocible del directorio contenedor como contexto adicional.

### Navegación, ordenación y movimiento de pestañas

- Se añadió el modo de ordenación «Usadas recientemente», que ordena globalmente las pestañas mediante MRU según la última vez que se activaron correctamente.
- Las pestañas nuevas que se abren y activan pasan a ser los elementos usados más recientemente; las que aún no se han activado conservan un orden estable.
- Se añadió la opción «Seguir siempre la pestaña activa»: al cambiar de editor, se expande automáticamente el grupo correspondiente y la pestaña activa se desplaza hasta quedar visible.
- Se añadieron ocho comandos configurables:
    - Ir a la pestaña anterior o siguiente dentro de un grupo.
    - Ir a la pestaña anterior o siguiente entre grupos.
    - Mover una pestaña hacia arriba o abajo dentro del grupo actual.
    - Mover una pestaña al grupo anterior o siguiente.
- Los comandos de movimiento admiten selección múltiple y conservan el orden relativo de las pestañas seleccionadas.
- La ordenación manual permite mover pestañas dentro de un grupo. La agrupación por directorio permite mover archivos entre grupos, mientras que la agrupación por tipo de archivo impide los movimientos entre grupos que no respeten la regla.

### Conjuntos de trabajo y restauración de sesiones

- Se añadieron conjuntos de trabajo con ámbito de área de trabajo que pueden guardar:
    - Las pestañas abiertas actualmente.
    - Los grupos nativos del editor y el orden de sus pestañas.
    - La pestaña activa.
    - Los grupos manuales y la ordenación manual.
    - El estado fijado de las pestañas y los grupos de pestañas.
    - El estado contraído de los grupos.
    - Los modos actuales de agrupación y ordenación.
- Los conjuntos de trabajo se pueden crear, cargar, sobrescribir, renombrar y eliminar desde la paleta de comandos o la barra de pestañas verticales.
- Antes de cargar, la extensión enumera las pestañas que podrían cerrarse y las pestañas sin guardar. Las pestañas sin guardar y fijadas están protegidas de forma predeterminada.
- Si falta una ruta original, la extensión solo la asocia automáticamente cuando existe exactamente un archivo con el mismo nombre en el área de trabajo, evitando restauraciones incorrectas.

### Visualización del estado de las pestañas

- Nota: esta parte todavía no se ha probado por completo.
- Se añadieron estados de recurso de solo lectura, incluidos el sistema de archivos de solo lectura, los permisos de solo lectura y las reglas de solo lectura de VS Code.
- Se añadieron estados para recursos inexistentes, falta de permisos de acceso y sistemas de archivos no disponibles.
- El estado se actualiza después de eliminar o restaurar archivos, o al cambiar los permisos o la configuración de solo lectura.
- El lado derecho de la pestaña muestra de forma uniforme los estados de vista previa, fijada, solo lectura, sin guardar, error de recurso y navegación no disponible.
- El estado sin guardar se concentra cerca del botón de cierre.
- Hay más anchura disponible para el texto de la pestaña. El botón de cierre solo aparece al pasar el puntero o cuando el foco del teclado entra en la pestaña.

### Diseño, posición y puntos de entrada

- Se añadió `verticalTabs.position`, que permite colocar la barra de pestañas verticales a la izquierda o a la derecha del área del editor y aplicar el cambio inmediatamente.
- Se añadió `verticalTabs.toolbarPosition`, que permite fijar la zona de herramientas encima o debajo de la lista de pestañas.
- Se añadió un botón permanente de mostrar/ocultar a la derecha de la barra de estado. Su icono cambia según la posición y la visibilidad de la barra de pestañas.
- La interfaz final utiliza los colores del tema de VS Code y botones de acción Codicon.

### Teclado y accesibilidad

- Cuando el foco está en una zona vacía de las pestañas verticales, se pueden utilizar las flechas, `Home`, `End` y `Enter` para recorrer y activar pestañas.
    - Su utilidad práctica es limitada: después de mover o activar una pestaña con el teclado, el foco entra en ella y ya no se puede seguir navegando por las pestañas verticales.
- Los menús de pestañas y grupos admiten la tecla Menú, `Shift+F10`, las flechas, `Enter`, Espacio y `Esc`.

## [0.2.1] - 2026-07-23

Se incluyó el README actualizado en la versión.

## [0.2.0] - 2026-07-23

Se completó la versión inicial.
