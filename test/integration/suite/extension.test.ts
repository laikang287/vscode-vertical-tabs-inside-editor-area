import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

suite('Vertical Tabs extension', () => {
  test('activates and exposes P0 commands', async () => {
    const extension = vscode.extensions.getExtension('laikang287.vertical-tabs-inside-editor-area');
    assert.ok(extension, 'The extension should be discoverable.');

    await extension.activate();
    assert.ok(extension.isActive, 'The extension should activate.');

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('verticalTabs.open'), 'The open command should be registered.');
    assert.ok(commands.includes('verticalTabs.toggle'), 'The toggle command should be registered.');
    assert.ok(commands.includes('verticalTabs.close'), 'The close command should be registered.');
    assert.ok(commands.includes('verticalTabs.focus'), 'The focus command should be registered.');
    assert.ok(commands.includes('verticalTabs.previous'), 'The previous command should be registered.');
    assert.ok(commands.includes('verticalTabs.next'), 'The next command should be registered.');
    for (const command of [
      'verticalTabs.previousInGroup',
      'verticalTabs.nextInGroup',
      'verticalTabs.previousAcrossGroups',
      'verticalTabs.nextAcrossGroups',
      'verticalTabs.moveUpInGroup',
      'verticalTabs.moveDownInGroup',
      'verticalTabs.moveToPreviousGroup',
      'verticalTabs.moveToNextGroup',
    ]) {
      assert.ok(commands.includes(command), `${command} should be registered.`);
    }
    assert.ok(commands.includes('verticalTabs.showLogs'), 'The show logs command should be registered.');

  });

  test('keeps one locked vertical-tabs group on the left and restores its width', async function () {
    this.timeout(10_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);

    const existingDocument = await vscode.workspace.openTextDocument({ content: 'editor already open before rail creation' });
    await vscode.window.showTextDocument(existingDocument, { preserveFocus: false });
    await vscode.commands.executeCommand('verticalTabs.open');
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1);
    await waitFor(() => verticalTabs()[0]?.group.tabs.length === 1);

    const [{ group }] = verticalTabs();
    assert.equal(group.viewColumn, vscode.ViewColumn.One, 'The vertical-tabs group should be the left-most group.');
    assert.equal(group.tabs.length, 1, 'The vertical-tabs panel should have an exclusive editor group.');
    assert.ok(vscode.window.tabGroups.all.filter((editorGroup) => editorGroup !== group).some((editorGroup) => editorGroup.tabs.some((tab) => (
      tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === existingDocument.uri.toString()
    ))), 'An editor already open before rail creation should remain outside the new left rail group.');

    const layout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    const railRatios = rootGroupRatios(layout);
    assert.ok(railRatios.some((ratio) => ratio >= 0.2 && ratio < 0.3), `The rail should use the configured 20% width unless VS Code enforces its native minimum group width; received ${JSON.stringify(layout)}.`);

    const existingTab = vscode.window.tabGroups.all.flatMap((editorGroup) => editorGroup.tabs).find((tab) => (
      tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === existingDocument.uri.toString()
    ));
    assert.ok(existingTab, 'The pre-existing editor tab should remain available for cleanup.');
    await vscode.window.tabGroups.close(existingTab, true);
    await waitFor(() => verticalTabs().length === 1 && vscode.window.tabGroups.all.length >= 2);
    const emptyRailLayout = await waitForEditorLayout((candidate) => rootGroupRatios(candidate).some((ratio) => ratio >= 0.2 && ratio < 0.3));
    const emptyRailRatios = rootGroupRatios(emptyRailLayout);
    assert.ok(emptyRailRatios.some((ratio) => ratio >= 0.2 && ratio < 0.3), `The rail should restore its configured width after the last right-side tab closes; received ${JSON.stringify(emptyRailLayout)}.`);
    assert.ok(nonVerticalTabs().some(({ tab }) => isBuiltInEditorTab(tab, 'welcome')), 'Closing the last right-side tab should still restore a usable welcome editor area.');

    await vscode.commands.executeCommand('verticalTabs.focus');
    const document = await vscode.workspace.openTextDocument({ content: 'locked rail verification' });
    await vscode.window.showTextDocument(document, { preserveFocus: false });
    assert.ok(!group.tabs.some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString()), 'A normal editor must not open in the locked rail group.');

    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await vscode.commands.executeCommand('verticalTabs.toggle');
    await waitFor(() => verticalTabs().length === 1);
    assert.equal(verticalTabs()[0].group.viewColumn, vscode.ViewColumn.One, 'Reopening from the launcher should put the rail back on the far left.');
  });

  test('takes rail space only from the editor group that was originally left-most', async function () {
    this.timeout(15_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await closeNonVerticalTabs();

    const firstDocument = await vscode.workspace.openTextDocument({ content: 'preserved first editor width' });
    await vscode.window.showTextDocument(firstDocument, { preserveFocus: false });
    await vscode.commands.executeCommand('workbench.action.newGroupRight');
    const secondDocument = await vscode.workspace.openTextDocument({ content: 'preserved second editor width' });
    await vscode.window.showTextDocument(secondDocument, { preserveFocus: false });
    await waitFor(() => vscode.window.tabGroups.all.length === 2);

    await vscode.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [{ size: 800 }, { size: 300 }],
    });
    const previousLayout = await waitForEditorLayout((candidate) => (
      candidate.groups.length === 2
      && candidate.groups.every((group) => typeof group.size === 'number')
    ));
    const previousSizes = previousLayout.groups.map((group) => group.size as number);

    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1 && vscode.window.tabGroups.all.length === 3);
    const nextLayout = await waitForEditorLayout((candidate) => (
      candidate.groups.length === 3
      && candidate.groups.every((group) => typeof group.size === 'number')
    ));
    const nextSizes = nextLayout.groups.map((group) => group.size as number);

    assert.ok(Math.abs(nextSizes[2] - previousSizes[1]) <= 1, `The non-leading editor width should remain unchanged; before ${JSON.stringify(previousLayout)}, after ${JSON.stringify(nextLayout)}.`);
    assert.ok(Math.abs(nextSizes[0] + nextSizes[1] - previousSizes[0]) <= 1, `Only the original leading editor should provide space for the rail; before ${JSON.stringify(previousLayout)}, after ${JSON.stringify(nextLayout)}.`);
  });

  test('preserves a minimized edge editor group when opening and hiding the rail on either side', async function () {
    this.timeout(30_000);
    const configuration = vscode.workspace.getConfiguration('verticalTabs');

    try {
      for (const position of ['left', 'right'] as const) {
        await vscode.commands.executeCommand('verticalTabs.close');
        await waitFor(() => verticalTabs().length === 0);
        await closeNonVerticalTabs();
        await configuration.update('position', position, vscode.ConfigurationTarget.Global);

        const firstDocument = await vscode.workspace.openTextDocument({ content: `${position} minimized edge first editor` });
        await vscode.window.showTextDocument(firstDocument, { preserveFocus: false });
        await vscode.commands.executeCommand('workbench.action.newGroupRight');
        const secondDocument = await vscode.workspace.openTextDocument({ content: `${position} minimized edge second editor` });
        await vscode.window.showTextDocument(secondDocument, { preserveFocus: false });
        await waitFor(() => vscode.window.tabGroups.all.length === 2);

        const minimizedIndex = position === 'left' ? 0 : 1;
        await vscode.commands.executeCommand('vscode.setEditorLayout', {
          orientation: 0,
          groups: position === 'left'
            ? [{ size: 220 }, { size: 1180 }]
            : [{ size: 1180 }, { size: 220 }],
        });
        const previousLayout = await waitForEditorLayout((candidate) => (
          candidate.groups.length === 2
          && candidate.groups[minimizedIndex]?.size === 220
          && candidate.groups.every((group) => typeof group.size === 'number')
        ));
        const previousSizes = previousLayout.groups.map((group) => group.size as number);
        const activeDocument = position === 'left' ? secondDocument : firstDocument;
        await vscode.window.showTextDocument(activeDocument, {
          viewColumn: position === 'left' ? vscode.ViewColumn.Two : vscode.ViewColumn.One,
          preserveFocus: false,
        });
        await waitFor(() => activeTextDocumentUri() === activeDocument.uri.toString());

        await vscode.commands.executeCommand('verticalTabs.open');
        await waitFor(() => verticalTabs().length === 1 && vscode.window.tabGroups.all.length === 3 && isRailAtEdge(position));
        await waitFor(() => activeTextDocumentUri() === activeDocument.uri.toString());
        const nextLayout = await waitForEditorLayout((candidate) => (
          candidate.groups.length === 3
          && candidate.groups.every((group) => typeof group.size === 'number')
        ));
        const nextSizes = nextLayout.groups.map((group) => group.size as number);
        const railIndex = position === 'left' ? 0 : 2;
        const widestIndexBefore = position === 'left' ? 1 : 0;
        const widestIndexAfter = position === 'left' ? 2 : 0;
        const railWidth = nextSizes[railIndex];
        const donatedWidth = previousSizes[widestIndexBefore] - nextSizes[widestIndexAfter];

        assert.ok(railWidth >= 222, `The ${position} rail should receive a safe width; before ${JSON.stringify(previousLayout)}, after ${JSON.stringify(nextLayout)}.`);
        assert.ok(
          Math.abs(nextSizes[1] - previousSizes[minimizedIndex]) <= 1,
          `The minimized ${position} edge editor should keep its width; before ${JSON.stringify(previousLayout)}, after ${JSON.stringify(nextLayout)}.`,
        );
        assert.ok(
          Math.abs(donatedWidth - railWidth) <= 1,
          `Only the widest editor should provide the ${position} rail width; before ${JSON.stringify(previousLayout)}, after ${JSON.stringify(nextLayout)}.`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 350));
        const stableOpenLayout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
        assert.ok(
          Math.abs((stableOpenLayout.groups[1]?.size ?? 0) - previousSizes[minimizedIndex]) <= 1,
          `The minimized ${position} edge editor should remain narrow after VS Code settles; before ${JSON.stringify(previousLayout)}, after ${JSON.stringify(stableOpenLayout)}.`,
        );

        await vscode.commands.executeCommand('verticalTabs.close');
        await waitFor(() => verticalTabs().length === 0 && vscode.window.tabGroups.all.length === 2);
        await waitFor(() => activeTextDocumentUri() === activeDocument.uri.toString());
        const hiddenLayout = await waitForEditorLayout((candidate) => (
          candidate.groups.length === 2
          && candidate.groups.every((group) => typeof group.size === 'number')
        ));
        const hiddenSizes = hiddenLayout.groups.map((group) => group.size as number);
        assert.ok(
          hiddenSizes.every((size, index) => Math.abs(size - previousSizes[index]) <= 1),
          `Hiding the ${position} rail should return its width to the original donor without redistributing other editors; before ${JSON.stringify(previousLayout)}, hidden ${JSON.stringify(hiddenLayout)}.`,
        );

        await vscode.commands.executeCommand('verticalTabs.open');
        await waitFor(() => verticalTabs().length === 1 && vscode.window.tabGroups.all.length === 3 && isRailAtEdge(position));
        await waitFor(() => activeTextDocumentUri() === activeDocument.uri.toString());
        await new Promise<void>((resolve) => setTimeout(resolve, 350));
        const reopenedLayout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
        const reopenedSizes = reopenedLayout.groups.map((group) => group.size as number);
        const reopenedRailWidth = reopenedSizes[railIndex];
        const reopenedDonatedWidth = previousSizes[widestIndexBefore] - reopenedSizes[widestIndexAfter];
        assert.ok(
          Math.abs(reopenedSizes[1] - previousSizes[minimizedIndex]) <= 1,
          `Reopening the ${position} rail must not activate and auto-expand the minimized edge editor; before ${JSON.stringify(previousLayout)}, reopened ${JSON.stringify(reopenedLayout)}.`,
        );
        assert.ok(
          reopenedRailWidth >= 222 && Math.abs(reopenedDonatedWidth - reopenedRailWidth) <= 1,
          `Reopening the ${position} rail should keep taking width only from the widest editor; before ${JSON.stringify(previousLayout)}, reopened ${JSON.stringify(reopenedLayout)}.`,
        );
      }
    } finally {
      await configuration.update('position', 'left', vscode.ConfigurationTarget.Global);
      if (verticalTabs().length > 0 && !isRailAtEdge('left')) {
        await waitFor(() => isRailAtEdge('left'));
      }
    }
  });

  test('creates on the right and applies live left-right position changes without losing focus', async function () {
    this.timeout(20_000);
    const configuration = vscode.workspace.getConfiguration('verticalTabs');
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await closeNonVerticalTabs();

    try {
      await configuration.update('position', 'right', vscode.ConfigurationTarget.Global);
      const document = await vscode.workspace.openTextDocument({ content: 'right rail focus restoration' });
      await vscode.window.showTextDocument(document, { preserveFocus: false });
      await vscode.commands.executeCommand('verticalTabs.open');
      await waitFor(() => verticalTabs().length === 1 && isRailAtEdge('right'));

      assert.equal(verticalTabs()[0]?.group.tabs.length, 1, 'The right rail should keep an exclusive editor group.');
      let layout = await waitForEditorLayout((candidate) => {
        const ratios = rootGroupRatios(candidate);
        return ratios.length >= 2 && (ratios.at(-1) ?? 1) <= 0.3;
      });
      assert.ok((rootGroupRatios(layout).at(-1) ?? 1) <= 0.3, `The right rail should use the shared narrow width; received ${JSON.stringify(layout)}.`);

      await vscode.window.showTextDocument(document, { preserveFocus: false });
      await waitFor(() => activeTextDocumentUri() === document.uri.toString());
      await configuration.update('position', 'left', vscode.ConfigurationTarget.Global);
      await waitFor(() => verticalTabs().length === 1 && isRailAtEdge('left'));
      await waitFor(() => activeTextDocumentUri() === document.uri.toString());
      assert.equal(verticalTabs()[0]?.group.tabs.length, 1, 'Moving left must not mix user tabs into the rail group.');

      await configuration.update('position', 'right', vscode.ConfigurationTarget.Global);
      await waitFor(() => verticalTabs().length === 1 && isRailAtEdge('right'));
      await waitFor(() => activeTextDocumentUri() === document.uri.toString());
      assert.equal(verticalTabs().length, 1, 'Live position changes must not create duplicate rails.');

      await vscode.commands.executeCommand('workbench.action.newGroupRight');
      const secondDocument = await vscode.workspace.openTextDocument({ content: 'right rail third editor group' });
      await vscode.window.showTextDocument(secondDocument, { preserveFocus: false });
      await waitFor(() => vscode.window.tabGroups.all.length === 3 && isRailAtEdge('right'));
      await vscode.commands.executeCommand('vscode.setEditorLayout', {
        orientation: 0,
        groups: [{ size: 690 }, { size: 690 }, { size: 220 }],
      });
      await vscode.commands.executeCommand('verticalTabs.focus');
      layout = await waitForEditorLayout((candidate) => candidate.groups.at(-1)?.size === 222);
      assert.equal(layout.groups.at(-1)?.size, 222, `The right rail should be nudged above VS Code's native minimum width in a three-group layout; received ${JSON.stringify(layout)}.`);

      const lockedDocument = await vscode.workspace.openTextDocument({ content: 'right locked rail verification' });
      await vscode.window.showTextDocument(lockedDocument, { preserveFocus: false });
      assert.ok(
        !verticalTabs()[0]?.group.tabs.some((tab) => tab.input instanceof vscode.TabInputText
          && tab.input.uri.toString() === lockedDocument.uri.toString()),
        'A normal editor must not open in the locked right rail group.',
      );

      await closeNonVerticalTabs();
      await waitFor(() => nonVerticalTabs().some(({ tab }) => isBuiltInEditorTab(tab, 'welcome')));
      await waitFor(() => isRailAtEdge('right'));
      const emptyStateGroups = vscode.window.tabGroups.all.map((group) => ({
        viewColumn: group.viewColumn,
        labels: group.tabs.map((tab) => tab.label),
        containsRail: group.tabs.some((tab) => isVerticalTabsTab(tab)),
      }));
      assert.ok(
        nonVerticalTabs().some(({ group }) => group.viewColumn < verticalTabs()[0].group.viewColumn),
        `With a right rail, the restored welcome editor area should be on its left. Groups: ${JSON.stringify(emptyStateGroups)}`,
      );

      await vscode.commands.executeCommand('verticalTabs.close');
      await waitFor(() => verticalTabs().length === 0);
      await vscode.commands.executeCommand('verticalTabs.open');
      await waitFor(() => verticalTabs().length === 1 && isRailAtEdge('right'));
      assert.equal(verticalTabs()[0]?.group.tabs.length, 1, 'Reopening should restore one exclusive right rail.');
    } finally {
      await configuration.update('position', 'left', vscode.ConfigurationTarget.Global);
      if (verticalTabs().length > 0) {
        await waitFor(() => isRailAtEdge('left'));
        await waitFor(() => verticalTabs().length === 1 && verticalTabs()[0]?.group.tabs.length === 1);
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    }
  });

  test('declares the startup and webview restoration activation events', () => {
    const manifestPath = path.resolve(__dirname, '../../../../package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      activationEvents: string[];
      contributes: {
        commands: Array<{ command: string; title: string; icon?: string }>;
        keybindings: Array<{ command: string }>;
        configuration: { properties: Record<string, { default: unknown; enum?: readonly unknown[]; scope?: string; markdownDescription?: string }> };
        viewsContainers: { activitybar: Array<{ id: string }> };
        views: Record<string, Array<{ id: string; visibility?: string; initialSize?: number }>>;
        menus: { 'view/title': Array<{ command: string; when: string }> };
      };
    };
    assert.ok(manifest.activationEvents.includes('onStartupFinished'));
    assert.ok(manifest.activationEvents.includes('onWebviewPanel:verticalTabs.editorArea'));
    assert.ok(!('verticalTabs.defaultRailWidthRatio' in manifest.contributes.configuration.properties));
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.position'].default, 'left');
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.rememberState'].default, true);
   assert.equal(manifest.contributes.configuration.properties['verticalTabs.tabWidthRatio'].default, 0.2);
    assert.match(manifest.contributes.configuration.properties['verticalTabs.tabWidthRatio'].markdownDescription ?? '', /%verticalTabs\.config\.tabWidthRatio%/);
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.defaultGroupMode'].default, 'vscode');
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.defaultSortMode'].default, 'none');
    assert.deepEqual(manifest.contributes.configuration.properties['verticalTabs.defaultSortMode'].enum, ['none', 'mru', 'modifiedAsc', 'modifiedDesc', 'nameAsc', 'nameDesc']);
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.toolbarPosition'].default, 'top');
    assert.deepEqual(manifest.contributes.configuration.properties['verticalTabs.toolbarPosition'].enum, ['top', 'bottom']);
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.toolbarPosition'].scope, 'window');
    assert.ok(manifest.contributes.viewsContainers.activitybar.some((view: { id: string }) => view.id === 'vertical-tabs-activitybar'));
    const launcher = manifest.contributes.views['vertical-tabs-activitybar']?.find((view) => view.id === 'verticalTabs.launcher');
    assert.equal(launcher?.visibility, 'collapsed');
    assert.equal(launcher?.initialSize, 1);
    assert.deepEqual(
      manifest.contributes.commands.find((entry) => entry.command === 'verticalTabs.open'),
      { command: 'verticalTabs.open', title: '%verticalTabs.command.open%', icon: '$(eye)' },
    );
    assert.deepEqual(
      manifest.contributes.commands.find((entry) => entry.command === 'verticalTabs.close'),
      { command: 'verticalTabs.close', title: '%verticalTabs.command.close%', icon: '$(eye-closed)' },
    );
    assert.ok(manifest.contributes.menus['view/title'].some((entry) => (
      entry.command === 'verticalTabs.open'
      && entry.when === 'view == verticalTabs.launcher && !verticalTabs.visible'
    )));
    assert.ok(manifest.contributes.menus['view/title'].some((entry) => (
      entry.command === 'verticalTabs.close'
      && entry.when === 'view == verticalTabs.launcher && verticalTabs.visible'
    )));
    const configurableCommands = [
      'verticalTabs.previousInGroup',
      'verticalTabs.nextInGroup',
      'verticalTabs.previousAcrossGroups',
      'verticalTabs.nextAcrossGroups',
      'verticalTabs.moveUpInGroup',
      'verticalTabs.moveDownInGroup',
      'verticalTabs.moveToPreviousGroup',
      'verticalTabs.moveToNextGroup',
    ];
    assert.ok(configurableCommands.every((command) => manifest.contributes.commands.some((entry) => entry.command === command)));
    assert.ok(configurableCommands.every((command) => !manifest.contributes.keybindings.some((entry) => entry.command === command)), 'Tab switching and moving commands must not have default keybindings.');
  });

  test('switches and moves tabs within and across editor groups', async function () {
    this.timeout(20_000);
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1);
    await closeNonVerticalTabs();
    await waitFor(() => nonVerticalTabs().some(({ tab }) => isBuiltInEditorTab(tab, 'welcome')));

    const sourceGroup = vscode.window.tabGroups.all.find((group) => !group.tabs.some((tab) => isVerticalTabsTab(tab)));
    assert.ok(sourceGroup, 'A user editor group should exist beside the vertical-tabs group.');
    const documents = await Promise.all([
      vscode.workspace.openTextDocument({ content: 'keyboard command first' }),
      vscode.workspace.openTextDocument({ content: 'keyboard command second' }),
      vscode.workspace.openTextDocument({ content: 'keyboard command third' }),
    ]);
    for (const document of documents) {
      await vscode.window.showTextDocument(document, { viewColumn: sourceGroup.viewColumn, preserveFocus: false, preview: false });
    }
    const documentUris = new Set(documents.map((document) => document.uri.toString()));
    const extraTabs = sourceGroup.tabs.filter((tab) => !(tab.input instanceof vscode.TabInputText && documentUris.has(tab.input.uri.toString())));
    if (extraTabs.length > 0) await vscode.window.tabGroups.close(extraTabs, true);
    await waitFor(() => textTabUris(sourceGroup).length === 3);

    await vscode.window.showTextDocument(documents[1], { viewColumn: sourceGroup.viewColumn, preserveFocus: false });
    await vscode.commands.executeCommand('verticalTabs.nextInGroup');
    await waitFor(() => activeTextDocumentUri() === documents[2].uri.toString());
    await vscode.commands.executeCommand('verticalTabs.previousInGroup');
    await waitFor(() => activeTextDocumentUri() === documents[1].uri.toString());

    await vscode.commands.executeCommand('verticalTabs.moveUpInGroup');
    await waitFor(() => textTabUris(sourceGroup)[0] === documents[1].uri.toString());
    assert.deepEqual(textTabUris(sourceGroup), [documents[1], documents[0], documents[2]].map((document) => document.uri.toString()));
    await vscode.commands.executeCommand('verticalTabs.moveDownInGroup');
    await waitFor(() => textTabUris(sourceGroup)[1] === documents[1].uri.toString());
    assert.deepEqual(textTabUris(sourceGroup), documents.map((document) => document.uri.toString()));

    await vscode.commands.executeCommand('workbench.action.newGroupRight');
    const destinationDocument = await vscode.workspace.openTextDocument({ content: 'keyboard command destination' });
    await vscode.window.showTextDocument(destinationDocument, { preserveFocus: false, preview: false });
    const destinationGroup = destinationDocumentTab(destinationDocument)?.group;
    assert.ok(destinationGroup && destinationGroup !== sourceGroup, 'A second user editor group should contain the destination document.');

    await vscode.window.showTextDocument(documents[2], { viewColumn: sourceGroup.viewColumn, preserveFocus: false });
    await vscode.commands.executeCommand('verticalTabs.nextAcrossGroups');
    await waitFor(() => activeTextDocumentUri() === destinationDocument.uri.toString());
    await vscode.commands.executeCommand('verticalTabs.previousAcrossGroups');
    await waitFor(() => activeTextDocumentUri() === documents[2].uri.toString());

    await vscode.window.showTextDocument(documents[1], { viewColumn: sourceGroup.viewColumn, preserveFocus: false });
    await vscode.commands.executeCommand('verticalTabs.moveToNextGroup');
    await waitFor(() => destinationDocumentTab(documents[1])?.group === destinationGroup);
    assert.equal(textTabUris(destinationGroup).at(-1), documents[1].uri.toString());
    await vscode.commands.executeCommand('verticalTabs.moveToPreviousGroup');
    await waitFor(() => destinationDocumentTab(documents[1])?.group === sourceGroup);
    assert.equal(textTabUris(sourceGroup).at(-1), documents[1].uri.toString());
  });

  test('activates existing built-in webview tabs without duplicating them', async function () {
    this.timeout(15_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);

    await verifyBuiltInWebviewNavigation('settings');
    await verifyBuiltInWebviewNavigation('welcome');

    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
  });

  test('rapid empty-state open requests restore one welcome editor area', async function () {
    this.timeout(15_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await closeNonVerticalTabs();
    await waitFor(() => vscode.window.tabGroups.all.every((group) => group.tabs.length === 0 || group.tabs.every((tab) => isVerticalTabsTab(tab))));

    await Promise.all([
      vscode.commands.executeCommand('verticalTabs.open'),
      vscode.commands.executeCommand('verticalTabs.focus'),
      vscode.commands.executeCommand('verticalTabs.open'),
      vscode.commands.executeCommand('verticalTabs.open'),
    ]);

    await waitFor(() => verticalTabs().length === 1);
    await waitFor(() => verticalTabs()[0]?.group.tabs.length === 1);
    await waitFor(() => nonVerticalTabs().length > 0);

    const rails = verticalTabs();
    assert.equal(rails.length, 1, 'Only one vertical-tabs panel should exist after rapid empty-state opens.');
    assert.equal(rails[0]?.group.viewColumn, vscode.ViewColumn.One, 'The vertical-tabs panel should be in the left-most group.');
    assert.equal(rails[0]?.group.tabs.length, 1, 'The rail group should contain only the vertical-tabs panel.');
    assert.equal(vscode.window.tabGroups.all.filter((group) => group.tabs.length === 0).length, 0, 'Rapid empty-state opens should not leave extra empty editor groups.');
    assert.ok(nonVerticalTabs().some(({ tab }) => isBuiltInEditorTab(tab, 'welcome')), 'The restored right editor area should contain the welcome editor.');
  });

  test('nudges the native minimum rail width before focus and restores it on reopen', async function () {
    this.timeout(15_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await closeNonVerticalTabs();

    const document = await vscode.workspace.openTextDocument({ content: 'minimum rail width persistence' });
    await vscode.window.showTextDocument(document, { preserveFocus: false });
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1);
    await waitFor(() => verticalTabs()[0]?.group.viewColumn === vscode.ViewColumn.One && verticalTabs()[0]?.group.tabs.length === 1);
    await waitFor(() => nonVerticalTabs().some(({ tab }) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString()));

    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 180 }, { size: 1420 }] });
    const safeMinimumLayout = await waitForEditorLayout((candidate) => candidate.groups[0]?.size === 222);
    assert.equal(safeMinimumLayout.groups[0]?.size, 222, `The extension should nudge the rail above VS Code's native 220px minimum; received ${JSON.stringify(safeMinimumLayout)}.`);

    await vscode.commands.executeCommand('verticalTabs.focus');
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const focusedLayout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    assert.equal(focusedLayout.groups[0]?.size, 222, `Focusing the rail must not expand it to the maximum width; received ${JSON.stringify(focusedLayout)}.`);

    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1);

    const reopenedLayout = await waitForEditorLayout((candidate) => {
      const ratios = rootGroupRatios(candidate);
      return ratios.length >= 2 && (candidate.groups[0]?.size ?? 0) > 220 && (ratios[0] ?? 1) <= 0.3;
    });
    const reopenedRatios = rootGroupRatios(reopenedLayout);
    assert.ok((reopenedRatios[0] ?? 1) <= 0.3, `The rail should restore its safe narrow ratio rather than expanding; received ${JSON.stringify(reopenedLayout)}.`);
  });

  test('corrects only the vertical-tabs group after a third editor group expands', async function () {
    this.timeout(15_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await closeNonVerticalTabs();

    const secondDocument = await vscode.workspace.openTextDocument({ content: 'second editor group' });
    await vscode.window.showTextDocument(secondDocument, { preserveFocus: false });
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1 && vscode.window.tabGroups.all.length >= 2);
    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('workbench.action.newGroupRight');
    const thirdDocument = await vscode.workspace.openTextDocument({ content: 'third editor group' });
    await vscode.window.showTextDocument(thirdDocument, { preserveFocus: false });
    await waitFor(() => vscode.window.tabGroups.all.length === 3);

    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [{ size: 300 }, { size: 1080 }, { size: 220 }],
    });
    await waitForEditorLayout((candidate) => candidate.groups[2]?.size === 220);

    await vscode.commands.executeCommand('workbench.action.focusThirdEditorGroup');
    const expandedLayout = await waitForEditorLayout((candidate) => (
      candidate.groups[0]?.size === 222
      && candidate.groups[1]?.size === 220
      && (candidate.groups[2]?.size ?? 0) > 220
    ));
    const expandedSizes = expandedLayout.groups.map((group) => group.size);
    assert.ok(expandedSizes.every((size): size is number => typeof size === 'number'));
    const expandedTotal = expandedSizes.reduce((total, size) => total + size, 0);
    assert.deepEqual(
      expandedSizes,
      [222, 220, expandedTotal - 442],
      `Only the vertical-tabs group should be nudged after the third group expands; received ${JSON.stringify(expandedLayout)}.`,
    );
  });
});

interface EditorLayoutGroup {
  readonly size?: number;
  readonly groups?: readonly EditorLayoutGroup[];
}

interface EditorLayout {
  readonly groups: readonly EditorLayoutGroup[];
}

function verticalTabs(): Array<{ tab: vscode.Tab; group: vscode.TabGroup }> {
  const result: Array<{ tab: vscode.Tab; group: vscode.TabGroup }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && (tab.input.viewType === 'verticalTabs.editorArea'
        || tab.input.viewType === 'mainThreadWebview-verticalTabs.editorArea')) {
        result.push({ tab, group });
      }
    }
  }
  return result;
}

function nonVerticalTabs(): Array<{ tab: vscode.Tab; group: vscode.TabGroup }> {
  const result: Array<{ tab: vscode.Tab; group: vscode.TabGroup }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!isVerticalTabsTab(tab)) {
        result.push({ tab, group });
      }
    }
  }
  return result;
}

function isRailAtEdge(position: 'left' | 'right'): boolean {
  const rail = verticalTabs()[0]?.group;
  const columns = vscode.window.tabGroups.all.map((group) => group.viewColumn);
  if (!rail || columns.length === 0) {
    return false;
  }
  return rail.viewColumn === (position === 'left' ? Math.min(...columns) : Math.max(...columns));
}

function rootGroupRatios(layout: EditorLayout): number[] {
  const sizes = layout.groups.map((group) => group.size);
  if (!sizes.every((size): size is number => typeof size === 'number' && size > 0)) {
    return [];
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => size / total);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for the editor state to settle. Groups: ${JSON.stringify(vscode.window.tabGroups.all.map((group) => ({
    viewColumn: group.viewColumn,
    isActive: group.isActive,
    activeLabel: group.activeTab?.label,
    labels: group.tabs.map((tab) => tab.label),
  })))}`);
}

async function waitForEditorLayout(predicate: (layout: EditorLayout) => boolean): Promise<EditorLayout> {
  let latest: EditorLayout | undefined;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    latest = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    if (predicate(latest)) {
      return latest;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for the editor layout to settle. Latest layout: ${JSON.stringify(latest)}.`);
}

async function verifyBuiltInWebviewNavigation(kind: 'settings' | 'welcome'): Promise<void> {
  await closeNonVerticalTabs();
  await waitFor(() => vscode.window.tabGroups.all.every((group) => group.tabs.every((tab) => isVerticalTabsTab(tab))));
  const document = await vscode.workspace.openTextDocument({ content: `navigation before ${kind}` });
  await vscode.window.showTextDocument(document, { preserveFocus: false });
  if (kind === 'settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings');
  } else {
    await openWelcomeForTest();
  }
  await waitFor(() => matchingBuiltInWebviewTabs(kind).length > 0);
  const before = matchingBuiltInWebviewTabs(kind).length;

  await vscode.window.showTextDocument(document, { preserveFocus: false });
  await waitFor(() => activeTextDocumentUri() === document.uri.toString());
  await vscode.commands.executeCommand('verticalTabs.open');
  await waitFor(() => verticalTabs().length === 1);
  await vscode.window.showTextDocument(document, { preserveFocus: false });
  await waitFor(() => activeTextDocumentUri() === document.uri.toString());

  await vscode.commands.executeCommand('verticalTabs.next');
  await waitFor(() => matchingBuiltInWebviewTabs(kind).some(({ tab, group }) => group.isActive && group.activeTab === tab));
  assert.equal(matchingBuiltInWebviewTabs(kind).length, before, `${kind} navigation should not create a duplicate tab.`);
  await closeNonVerticalTabs();
}

function matchingBuiltInWebviewTabs(kind: 'settings' | 'welcome'): Array<{ tab: vscode.Tab; group: vscode.TabGroup }> {
  const result: Array<{ tab: vscode.Tab; group: vscode.TabGroup }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (isBuiltInEditorTab(tab, kind)) {
        result.push({ tab, group });
      }
    }
  }
  return result;
}

function isBuiltInEditorTab(tab: vscode.Tab, kind: 'settings' | 'welcome'): boolean {
  const viewType = tab.input instanceof vscode.TabInputWebview ? tab.input.viewType.toLowerCase() : '';
  const label = tab.label.toLowerCase();
  if (kind === 'settings') {
    return viewType.includes('settings') || viewType.includes('preferences') || label.includes('settings') || label === '设置';
  }
  return viewType.includes('welcome') || viewType.includes('gettingstarted') || label.includes('welcome') || label.includes('getting started') || label === '欢迎';
}

function activeTextDocumentUri(): string | undefined {
  const active = vscode.window.tabGroups.activeTabGroup.activeTab;
  return active?.input instanceof vscode.TabInputText ? active.input.uri.toString() : undefined;
}

function textTabUris(group: vscode.TabGroup): string[] {
  return group.tabs.flatMap((tab) => tab.input instanceof vscode.TabInputText ? [tab.input.uri.toString()] : []);
}

function destinationDocumentTab(document: vscode.TextDocument): { tab: vscode.Tab; group: vscode.TabGroup } | undefined {
  return nonVerticalTabs().find(({ tab }) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString());
}

async function closeNonVerticalTabs(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => !isVerticalTabsTab(tab));
    if (tabs.length === 0) {
      return;
    }
    await vscode.window.tabGroups.close(tabs, true);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

function isVerticalTabsTab(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputWebview && (tab.input.viewType === 'verticalTabs.editorArea'
    || tab.input.viewType === 'mainThreadWebview-verticalTabs.editorArea');
}

async function openWelcomeForTest(): Promise<void> {
  const attempts: Array<readonly [string, ...unknown[]]> = [
    ['workbench.action.openWelcome'],
    ['workbench.action.openWalkthrough', 'gettingStarted', false],
    ['workbench.action.openWalkthrough', { category: 'gettingStarted' }, false],
  ];
  let latestError: unknown;
  for (const [command, ...args] of attempts) {
    try {
      await vscode.commands.executeCommand(command, ...args);
      return;
    } catch (error) {
      latestError = error;
    }
  }
  throw latestError;
}
