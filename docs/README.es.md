
# Pestañas Verticales en el Área del Editor


[English](README.md) · [简体中文（规范源）](README.zh-CN.md) · [繁體中文](docs/README.zh-TW.md) · [日本語](docs/README.ja.md) · [한국어](docs/README.ko.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [Deutsch](docs/README.de.md) · [Русский](docs/README.ru.md)

Muestra una <mark>barra de pestañas vertical</mark> siempre visible en el <mark>lado izquierdo del área del editor</mark>, sin ocupar las barras laterales principal ni secundaria.

El diseño de la interfaz es el siguiente:

```text
Barra lateral principal | Barra de pestañas vertical | Área del editor | Barra lateral secundaria
```

## Demo

![demo.gif](media/demo.gif)

## Por Qué Esta Extensión

VS Code utiliza una barra de pestañas horizontal por defecto. Al abrir muchos archivos, los nombres de las pestañas se truncan fácilmente, lo que dificulta encontrar y cambiar entre archivos.

Muchas extensiones de pestañas verticales colocan la lista de pestañas en la barra lateral principal, pero esta también necesita mostrar el explorador de archivos, la búsqueda, el control de código fuente, las extensiones y otras funciones.

Cuando los usuarios cambian entre funciones de la barra lateral, las pestañas verticales también se ocultan.

Esta extensión coloca la barra de pestañas vertical en el lado izquierdo del área del editor, por lo que permanece visible incluso al cambiar entre otras funciones de la barra lateral principal.

## Para Quién Es

- Quienes trabajan frecuentemente con muchos archivos abiertos a la vez
- Quienes disponen de suficiente espacio horizontal en pantalla
- Quienes no quieren que las pestañas verticales ocupen la barra lateral principal

## Funcionalidades

- **Muestra pestañas verticales en el lado izquierdo del área del editor**
- Soporte multilingüe (i18n)
- Grupos de pestañas, incluidos agrupación automática y manual (por tipo, por directorio padre, o siguiendo la barra de pestañas horizontal de VS Code)
- Ordenación de pestañas: manual, por nombre, por tiempo
- Mostrar/ocultar la barra de pestañas vertical
- Operaciones básicas de pestañas:
	- Arrastrar para agrupar
	- Cierre por lotes
	- Expandir todo
	- Colapsar todo
	- Clic derecho para fijar pestañas y grupos de pestañas
	- Movimiento por lotes (usa la tecla Shift para selección múltiple)
- Cuando el tipo de grupo es "directorio padre", arrastrar un archivo a otro grupo mueve el archivo real en disco

## Inicio Rápido

- Busca "Vertical Tabs Inside Editor Area" en el marketplace de extensiones de VS Code e instálalo. El identificador de la extensión es `laikang287.vertical-tabs-inside-editor-area`
- Reinicia VS Code
- Encuentra el icono `VERTICAL TABS` en la barra de actividades de VS Code, haz clic para abrir la vista. Usa Show/Hide para mostrar u ocultar la barra de pestañas vertical
- Nota 1: Puedes arrastrar la vista `VERTICAL TABS` a otras áreas de uso frecuente dentro de la barra de actividades
	- Consulta el GIF de demostración arriba
- Nota 2: Se recomienda mantener desactivado el ajuste de línea de pestañas de VS Code al usar esta extensión:

```json
{
  "workbench.editor.wrapTabs": false
}
```

## Cómo Cambiar el Idioma de la Interfaz

La opción de configuración `verticalTabs.language` permite cambiar el idioma de la extensión. El valor predeterminado es `auto`.

## Cómo Funciona

Al iniciarse, la extensión crea un Webview y lo coloca en un grupo de editor independiente en el extremo izquierdo del área del editor.

Este Webview se utiliza para mostrar las pestañas verticales.

Luego, la extensión utiliza la función de bloqueo de grupo de editores de VS Code para bloquear ese grupo, evitando que los nuevos archivos abiertos posteriormente entren en el grupo de editor ocupado por la barra de pestañas vertical.

## Notas

1. Este proyecto utilizó herramientas de programación con IA durante el desarrollo para ayudar en la escritura de código, pruebas y documentación
2. La documentación se basa en README.zh-CN; las versiones en otros idiomas son traducciones realizadas por IA
3. La documentación en chino simplificado es la versión principal de mantenimiento de este proyecto
4. Esta extensión implementa las pestañas verticales mediante una solución indirecta, por lo que se trata de un recurso provisional. La mejor solución sería que VS Code ofreciera compatibilidad oficial con las pestañas verticales.

	Da tu voto favorable al issue relacionado de VS Code para que el equipo reconozca la demanda y preste más atención a esta función:

    [Add support for vertical tabs · Issue #108264 · microsoft/vscode](https://github.com/microsoft/vscode/issues/108264)

## Licencia

Licencia MIT - consulta [LICENSE](LICENSE)

## Instalación Manual

- Busca el repositorio `vscode-vertical-tabs-inside-editor-area` en GitHub, localiza el archivo `.vsix` más reciente en su directorio releases y descárgalo
	- Repositorio de GitHub: [vscode-vertical-tabs-inside-editor-area](https://github.com/laikang287/vscode-vertical-tabs-inside-editor-area/tree/main/releases)
- Abre VS Code, ve a la vista de Extensiones en la barra de actividades, haz clic en el menú de tres puntos en la esquina superior derecha de la barra lateral y selecciona "Instalar desde VSIX..."
