/* global _, trackJs */
import XXHash from 'xxhashjs';
import slug from 'slug';
import {hashHistory} from 'react-router';

import {userStore, prototypoStore, undoableStore, fontInstanceStore} from '../stores/creation.stores.jsx';
import LocalServer from '../stores/local-server.stores.jsx';
import LocalClient from '../stores/local-client.stores.jsx';

import {Typefaces} from '../services/typefaces.services.js';
import {FontValues} from '../services/values.services.js';
import Log from '../services/log.services.js';
import HoodieApi from '../services/hoodie.services.js';
import {loadStuff} from '../helpers/appSetup.helpers.js';

import {copyFontValues, loadFontValues, saveAppValues} from '../helpers/loadValues.helpers.js';
import {BatchUpdate} from '../helpers/undo-stack.helpers.js';

import WorkerPool from '../worker/worker-pool.js';

import {fontToSfntTable} from '../opentype/font.js';

slug.defaults.mode = 'rfc3986';
slug.defaults.modes.rfc3986.remove = /[-_\/\\\.]/g;
let localServer;
let localClient;
let undoWatcher;

const debouncedSave = _.throttle((values, db) => {
	FontValues.save({
		typeface: db || 'default',
		values,
	});
}, 300);


function paramAuthorized(plan, credits) {
	const paidPlan = plan.indexOf('free_') === -1;
	const enoughCredits = credits && credits > 0;

	return paidPlan || enoughCredits;
}

let oldFont;

window.addEventListener('fluxServer.setup', () => {
	localClient = LocalClient.instance();
	localServer = LocalServer.instance;

	undoWatcher = new BatchUpdate(
		undoableStore,
		'/undoableStore',
		'controlsValues',
		localClient,
		localServer.lifespan,
		(name) => {
			return `${name} modification`;
		},
		(headJS) => {
			debouncedSave(headJS.controlsValues);
		}
	);
});

const hasher = XXHash(0xDEADBEEF);

export default {
	'/create-font-instance': ({typedataJSON, appValues}) => {
		const typedata = JSON.parse(typedataJSON);
		const familyName = typedata.fontinfo.familyName;
		const controls = typedata.controls;
		const presets = typedata.presets;
		const tags = typedata.fontinfo.tags;
		const db = appValues.values.variantSelected.db;

		localClient.dispatchAction('/store-value-font', {
			familyName,
			db,
			typedata,
		});

		localClient.dispatchAction('/create-font', typedata);
		localClient.dispatchAction('/load-params', {controls, presets});
		localClient.dispatchAction('/load-tags', tags);
		loadFontValues(typedata, db);
	},
	'/load-font-instance': async ({appValues}) => {
		try {
			const template = appValues.values.familySelected ? appValues.values.familySelected.template : undefined;
			const typedataJSON = await Typefaces.getFont(template || 'venus.ptf');

			localClient.dispatchAction('/create-font-instance', {
				typedataJSON,
				appValues,
			});
		}
		catch (err) {
			trackJs.track(err);
			console.log(err);
		}

	},
	'/create-font': (typedata) => {
		const fontWorkerPool = new WorkerPool();

		fontWorkerPool.eachJob({
			action: {
				type: 'createFont',
				data: typedata,
			},
			callback: () => {
				localClient.dispatchAction('/store-value-font', {
					fontWorkerPool,
				});
			},
		});

		fontWorkerPool.doFastJob({
			action: {
				type: 'createFont',
				data: typedata,
			},
			callback: () => {
			},
		});

		const patch = prototypoStore
			.set('fontName', typedata.fontinfo.familyName)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/change-font-from-typedata': async ({typedataJSON, db}) => {
		const typedata = JSON.parse(typedataJSON);

		localClient.dispatchAction('/store-value-font', {
			familyName: typedata.fontinfo.familyName,
			db,
			typedataJSON,
		});

		localClient.dispatchAction('/create-font', typedata);

		localClient.dispatchAction('/load-params', {controls: typedata.controls, presets: typedata.presets});
		localClient.dispatchAction('/load-tags', typedata.fontinfo.tags);
		localClient.dispatchAction('/clear-undo-stack');

		loadFontValues(typedata, db);
	},
	'/change-font': async ({templateToLoad, db}) => {
		const typedataJSON = await Typefaces.getFont(templateToLoad);

		localClient.dispatchAction('/change-font-from-typedata', {
			typedataJSON,
			db,
		});
		localClient.dispatchAction('/toggle-individualize', {targetIndivValue: false});
		localClient.dispatchAction('/store-value', {uiSpacingMode: false});
	},
	'/create-family': async ({name, template, loadCurrent, startApp = false}) => {
		let templateToLoad = template;

		if (loadCurrent) {
			templateToLoad = prototypoStore.get('family').template;
		}

		if (templateToLoad === undefined) {
			const patch = prototypoStore
			.set('errorAddFamily', 'You must choose a base template')
			.commit();

			localServer.dispatchUpdate('/prototypoStore', patch);
			return;
		}

		if (name === undefined || name === '' || String(name).trim() === '') {
			const patch = prototypoStore.set('errorAddFamily', 'You must choose a name for your family').commit();

			localServer.dispatchUpdate('/prototypoStore', patch);
			return;
		}

		const fonts = _.cloneDeep(Array.from(prototypoStore.get('fonts')));
		const newFont = {
			name,
			template: templateToLoad,
			variants: [
				{
					id: hasher.update(`Regular${(new Date()).getTime()}`).digest().toString(16),
					name: 'Regular',
					db: slug(`${name}regular`, ''),
				},
			],
		};

		const already = _.find(fonts, (font) => {
			return font.name === name;
		});

		if (already) {
			const patch = prototypoStore.set('errorAddFamily', 'A Family with this name already exists').commit();

			localServer.dispatchUpdate('/prototypoStore', patch);
			return;
		}

		fonts.push(newFont);

		const patch = prototypoStore
			.set('errorAddFamily', undefined)
			.set('createdFamily', newFont)
			.set('fonts', fonts)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patch);

		if (loadCurrent) {
			await copyFontValues(newFont.variants[0].db);
		}

		localClient.dispatchAction('/change-font', {
			templateToLoad,
			db: newFont.variants[0].db,
		});

		const patchVariant = prototypoStore
			.set('variant', newFont.variants[0])
			.set('family', {name: newFont.name, template: newFont.template})
			.set('uiCreatefamilySelectedTemplate', undefined)
			.set('openFamilyModal', false)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patchVariant);

		saveAppValues();
		window.Intercom('update',
			{
				number_of_family: prototypoStore.get('fonts').length,
			}
		);
		Log.ui(`createFamily.${template}`);

		if (startApp) {
			const accountValues = userStore.get('infos');

			await loadStuff(accountValues.accountValues ? accountValues.accountValues : accountValues, newFont);
			hashHistory.push({pathname: '/dashboard'});
		}
	},
	'/select-variant': ({family, variant = family.variants[0]}) => {
		const patchVariant = prototypoStore
			.set('variant', variant)
			.set('family', {name: family.name, template: family.template}).commit();

		localServer.dispatchUpdate('/prototypoStore', patchVariant);

		localClient.dispatchAction('/change-font', {
			templateToLoad: family.template,
			db: variant.db,
		});
		saveAppValues();
	},
	'/create-variant-from-ref': ({ref, name, variant, family, noSwitch}) => {
		const thicknessTransform = [
			{string: 'Thin', thickness: 20},
			{string: 'Light', thickness: 50},
			{string: 'Book', thickness: 70},
			{string: 'Bold', thickness: 115},
			{string: 'Semi-Bold', thickness: 100},
			{string: 'Extra-Bold', thickness: 135},
			{string: 'Black', thickness: 150},
		];

		_.each(thicknessTransform, (item) => {
			if (name.indexOf(item.string) !== -1) {
				ref.values.thickness = item.thickness;
			}
		});

		if (name.indexOf('Italic') !== -1) {
			ref.values.slant = 10;
		}

		setTimeout(async () => {
			await FontValues.save({typeface: variant.db, values: ref.values});
			if (!noSwitch) {
				localClient.dispatchAction('/select-variant', {variant, family});
			}
		}, 200);

		localClient.dispatchAction('/store-value', {
			openVariantModal: false,
			openDuplicateVariantModal: false,
			errorAddVariant: undefined,
		});
		window.Intercom('update',
			{
				number_of_variants: _.reduce(prototypoStore.get('fonts'), (acc, value) => {
					return acc + value.variants.length;
				}, 0),
			}
		);
	},
	'/create-variant': async ({name, familyName, variantBase, noSwitch}) => {
		if (!name || String(name).trim() === '') {
			const patch = prototypoStore.set('errorAddVariant', 'Variant name cannot be empty').commit();

			localServer.dispatchUpdate('/prototypoStore', patch);
			return;
		}

		const family = _.find(Array.from(prototypoStore.get('fonts') || []), (font) => {
			return font.name === familyName;
		});

		const already = _.find(family.variants, (item) => {
			return item.name === name;
		});

		if (already) {
			const patch = prototypoStore.set('errorAddVariant', 'Variant with this name already exists').commit();

			localServer.dispatchUpdate('/prototypoStore', patch);
			return;
		}

		const variant = {
			id: hasher.update(`${name}${(new Date()).getTime()}`).digest().toString(16),
			name,
			db: slug(`${familyName}${name}`, ''),
		};

		family.variants.push(variant);

		//TODO(franz): this is fucked up
		const patch = prototypoStore
			.set('fonts', _.cloneDeep(prototypoStore.get('fonts')))
			.set('errorAddVariant', undefined).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);

		const variantBaseDb = variantBase ? variantBase.db : family.variants[0].db;

		const ref = await FontValues.get({typeface: variantBaseDb});

		localClient.dispatchAction('/create-variant-from-ref', {
			name,
			ref,
			variant,
			family,
			noSwitch,
		});
	},
	'/edit-variant': ({variant, family, newName}) => {
		if (!newName || String(newName).trim() === '') {
			localClient.dispatchAction('/store-value', {
				errorVariantNameChange: "The variant name cannot be empty",
			});
			return;
		}

		const fonts = _.cloneDeep(prototypoStore.get('fonts') || []);
		const found = _.find(fonts, (item) => {
			return item.name === family.name;
		});
		const alreadyExists = _.find(found.variants || [], (item) => {
			return item.name === newName;
		});

		if (alreadyExists) {
			localClient.dispatchAction('/store-value', {
				errorVariantNameChange: "You already have a variant with this name in this family",
			});
			return;
		}

		const newVariant = _.find(found.variants || [], (item) => {
			return variant.id === item.id;
		});

		newVariant.name = newName;

		//If we modify selected variant patch selected variant.
		if (variant.id === prototypoStore.get('variant').id) {
			prototypoStore.set('variant', newVariant);
		}

		const patch = prototypoStore
			.set('fonts', fonts)
			.set('collectionSelectedVariant', newVariant)
			.set('openChangeVariantNameModal', false)
			.commit();

		localClient.dispatchAction('/store-value', {
			errorVariantNameChange: undefined,
		});

		localServer.dispatchUpdate('/prototypoStore', patch);
		saveAppValues();
	},
	'/edit-family-name': ({family, newName}) => {
		if (!newName || String(newName).trim() === '') {
			localClient.dispatchAction('/store-value', {
				errorFamilyNameChange: "The family name cannot be empty",
			});
			return;
		}

		const fonts = _.cloneDeep(prototypoStore.get('fonts') || []);
		const alreadyExists = _.find(fonts, (item) => {
			return item.name === newName;
		});

		if (alreadyExists) {
			localClient.dispatchAction('/store-value', {
				errorFamilyNameChange: "You already have a font with this family name",
			});
			return;
		}

		const newFamily = _.find(fonts, (item) => {
			return item.name === family.name;
		});

		newFamily.name = newName;

		if (family.name === prototypoStore.get('family').name) {
			prototypoStore.set('family', newFamily);
		}

		//TODO(franz): this is fucked up
		const patch = prototypoStore
			.set('fonts', fonts)
			.set('collectionSelectedFamily', newFamily)
			.set('openChangeFamilyNameModal', false)
			.commit();

		localClient.dispatchAction('/store-value', {
			errorFamilyNameChange: undefined,
		});

		localServer.dispatchUpdate('/prototypoStore', patch);
		saveAppValues();
	},
	'/delete-variant': ({variant, familyName}) => {
		const families = _.cloneDeep(Array.from(prototypoStore.get('fonts') || []));
		const currentVariant = prototypoStore.get('variant');
		const currentFamily = prototypoStore.get('family');

		const family = _.find(families, (item) => {
			return item.name === familyName;
		});

		_.remove(family.variants, (item) => {
			return item.id === variant.id;
		});

		if (family.name === currentFamily.name && family.template === currentFamily.template && variant.id === currentVariant.id) {
			const defaultVariant = family.variants[0];

			prototypoStore.set('variant', defaultVariant);
			localClient.dispatchAction('/change-font', {
				templateToLoad: family.template,
				db: defaultVariant.db,
			});
		}

		const patch = prototypoStore.set('fonts', families).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
		saveAppValues();

	},
	'/delete-family': ({family}) => {
		const families = _.cloneDeep(Array.from(prototypoStore.get('fonts')));
		const currentFamily = prototypoStore.get('family');

		_.remove(families, (checkee) => {
			return checkee.name === family.name && checkee.template === family.template;
		});

		if (family.name === currentFamily.name && family.template === currentFamily.template) {
			const newFamily = families[0];
			const newVariant = families[0].variants[0];

			prototypoStore.set('family', newFamily);
			prototypoStore.set('variant', newVariant);
			localClient.dispatchAction('/change-font', {
				templateToLoad: newFamily.template,
				db: newVariant.db,
			});
		}

		const patch = prototypoStore.set('fonts', families).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);

		family.variants.forEach((variant) => {
			FontValues.deleteDb({typeface: variant.db});
		});

		saveAppValues();
	},
	'/clear-error-variant': () => {
		const patch = prototypoStore.set('errorAddVariant', undefined).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/select-family-collection': (family) => {
		const patch = prototypoStore
			.set('collectionSelectedFamily', family)
			.set('collectionSelectedVariant', undefined)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/select-variant-collection': (variant) => {
		const patch = prototypoStore.set('collectionSelectedVariant', variant).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/close-create-family-modal': () => {
		const patch = prototypoStore.set('openFamilyModal', false).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/close-create-variant-modal': () => {
		const patch = prototypoStore.set('openVariantModal', false).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/change-param': ({values, value, name, force, label}) => {
		const indivMode = prototypoStore.get('indivMode');
		const indivEdit = prototypoStore.get('indivEditingParams');
		const db = (prototypoStore.get('variant') || {}).db;
		const currentGroupName = (prototypoStore.get('indivCurrentGroup') || {}).name;
		let newParams = {...undoableStore.get('controlsValues')};

		if (indivMode && indivEdit && !values) {
			if (newParams.indiv_group_param[currentGroupName][name]) {
				newParams.indiv_group_param = {
					...newParams.indiv_group_param,
					[currentGroupName]: {
						...newParams.indiv_group_param[currentGroupName],
						[name]: {
							...newParams.indiv_group_param[currentGroupName][name],
							value,
						},
					},
				};
			}
			else {
				newParams.indiv_group_param = {
					...newParams.indiv_group_param,
					[currentGroupName]: {
						...newParams.indiv_group_param[currentGroupName],
						[name]: {
							state: 'relative',
							value,
						},
					},
				};
			}
		}
		else if (values) {
			newParams = {...newParams, ...values};
		}
		else {
			newParams[name] = value;
		}

		const patch = undoableStore.set('controlsValues', newParams).commit();

		localServer.dispatchUpdate('/undoableStore', patch);
		localClient.dispatchAction('/update-font', newParams);

		debouncedSave(newParams, db);
		if (force) {
			//TODO(franz): This SHOULD totally end up being in a flux store on hoodie
			undoWatcher.forceUpdate(patch, label);
		}
		else {
			undoWatcher.update(patch, label);
		}

	},
	'/change-param-state': ({name, state, force, label}) => {
		const db = prototypoStore.get('variant').db;
		const currentGroupName = prototypoStore.get('indivCurrentGroup').name;
		const newParams = {...undoableStore.get('controlsValues')};

		newParams.indiv_group_param[currentGroupName][name] = {
			state,
			value: state === 'relative' ? 1 : 0,
		};

		const patch = undoableStore.set('controlsValues', newParams).commit();

		localServer.dispatchUpdate('/undoableStore', patch);
		localClient.dispatchAction('/update-font', newParams);
		debouncedSave(newParams, db);

		if (force) {
			//TODO(franz): This SHOULD totally end up being in a flux store on hoodie
			undoWatcher.forceUpdate(patch, label);
		}
		else {
			undoWatcher.update(patch, label);
		}
	},
	'/change-letter-spacing': ({value, side, letter, label, force}) => {
		const db = (prototypoStore.get('variant') || {}).db;
		const oldValues = undoableStore.get('controlsValues');
		const newParams = {
			...oldValues,
			glyphSpecialProps: {...oldValues.glyphSpecialProps},
		};

		const unicode = letter.charCodeAt(0);

		newParams.glyphSpecialProps = newParams.glyphSpecialProps || {};
		newParams.glyphSpecialProps[unicode] = {...newParams.glyphSpecialProps[unicode]} || {};

		if (side === 'left') {
			newParams.glyphSpecialProps[unicode].spacingLeft = value;
		}
		else {
			newParams.glyphSpecialProps[unicode].spacingRight = value;
		}

		const patch = undoableStore.set('controlsValues', newParams).commit();

		localServer.dispatchUpdate('/undoableStore', patch);
		localClient.dispatchAction('/update-font', newParams);

		debouncedSave(newParams, db);

		if (force) {
			undoWatcher.forceUpdate(patch, label);
		}
		else {
			undoWatcher.update(patch, label);
		}

	},
	'/change-glyph-node-manually': ({changes, force, label = 'glyph node manual', glyphName}) => {
		const db = (prototypoStore.get('variant') || {}).db;
		const oldValues = undoableStore.get('controlsValues');
		const manualChanges = _.cloneDeep(oldValues.manualChanges) || {};

		manualChanges[glyphName] = manualChanges[glyphName] || {};
		manualChanges[glyphName].cursors = manualChanges[glyphName].cursors || {};

		const newParams = {
			...oldValues,
			manualChanges: {
				...manualChanges,
				[glyphName]: {
					...manualChanges[glyphName],
					cursors: {
						...manualChanges[glyphName].cursors,
						...changes,
					},
				},
			},
		};

		const patch = undoableStore.set('controlsValues', newParams).commit();

		localServer.dispatchUpdate('/undoableStore', patch);
		localClient.dispatchAction('/update-font', newParams);

		debouncedSave(newParams, db);

		if (force) {
			undoWatcher.forceUpdate(patch, label);
		}
		else {
			undoWatcher.update(patch, label);
		}
	},
	'/reset-glyph-node-manually': ({contourId, nodeId, force = true, label = 'reset manual', glyphName}) => {
		const db = (prototypoStore.get('variant') || {}).db;
		const oldValues = undoableStore.get('controlsValues');
		const manualChanges = _.cloneDeep(oldValues.manualChanges) || {};

		manualChanges[glyphName] = manualChanges[glyphName] || {};
		manualChanges[glyphName].cursors = manualChanges[glyphName].cursors || {};

		// adding deltas to modified cursors
		Object.keys(manualChanges[glyphName].cursors).forEach((cursorKey) => {
			if (cursorKey.indexOf(`contours.${contourId}.nodes.${nodeId}`) !== -1) {
				delete manualChanges[glyphName].cursors[cursorKey];
			}
		});

		const newParams = {
			...oldValues,
			manualChanges: {
				...manualChanges,
				[glyphName]: {
					...manualChanges[glyphName],
					cursors: {
						...manualChanges[glyphName].cursors,
					},
				},
			},
		};

		const patch = undoableStore.set('controlsValues', newParams).commit();

		localServer.dispatchUpdate('/undoableStore', patch);
		localClient.dispatchAction('/update-font', newParams);

		debouncedSave(newParams, db);

		if (force) {
			undoWatcher.forceUpdate(patch, label);
		}
		else {
			undoWatcher.update(patch, label);
		}
	},
	'/reset-glyph-manually': ({glyphName, force = true, label = 'reset manual'}) => {
		const db = (prototypoStore.get('variant') || {}).db;
		const oldValues = undoableStore.get('controlsValues');
		const manualChanges = _.cloneDeep(oldValues.manualChanges) || {};

		delete manualChanges[glyphName];

		const newParams = {
			...oldValues,
			manualChanges,
		};

		const patch = undoableStore.set('controlsValues', newParams).commit();

		localServer.dispatchUpdate('/undoableStore', patch);
		localClient.dispatchAction('/update-font', newParams);

		debouncedSave(newParams, db);

		if (force) {
			undoWatcher.forceUpdate(patch, label);
		}
		else {
			undoWatcher.update(patch, label);
		}
	},

	'/reset-all-glyphs': ({force = true, label = 'reset all glyphs'}) => {
		const db = (prototypoStore.get('variant') || {}).db;
		const oldValues = undoableStore.get('controlsValues');
		const manualChanges = {};
		const newParams = {
			...oldValues,
			manualChanges,
		};
		const patch = undoableStore.set('controlsValues', newParams).commit();

		localServer.dispatchUpdate('/undoableStore', patch);
		localClient.dispatchAction('/update-font', newParams);

		debouncedSave(newParams, db);

		if (force) {
			undoWatcher.forceUpdate(patch, label);
		}
		else {
			undoWatcher.update(patch, label);
		}
	},

	'/change-component': ({glyph, id, name, label = 'change component'}) => {
		const db = (prototypoStore.get('variant') || {}).db;
		const oldValues = undoableStore.get('controlsValues');
		const newParams = {
			...oldValues,
			glyphComponentChoice: {...oldValues.glyphComponentChoice},
		};

		newParams.glyphComponentChoice[glyph.ot.unicode] = {
			...newParams.glyphComponentChoice[glyph.ot.unicode],
			[id]: name,
		};

		const patch = undoableStore.set('controlsValues', newParams).commit();

		localServer.dispatchUpdate('/undoableStore', patch);
		localClient.dispatchAction('/update-font', newParams);

		debouncedSave(newParams, db);

		undoWatcher.forceUpdate(patch, label);
	},
	'/set-preset': (presetName) => {
		const presets = prototypoStore.get('fontPresets');

		if (presets && presets[presetName]) {
			localClient.dispatchAction('/change-param', {
				values: presets[presetName],
				force: true,
				label: 'preset',
			});
		}
	},
	'/update-font': (params) => {
		const pool = fontInstanceStore.get('fontWorkerPool');
		const subset = 'Thequickfoxjmpvrtlazydg';
		const glyph = ['b'];
		const jobs = [];

		pool.doFastJob({
			action: {
				type: 'constructGlyphs',
				data: {
					params,
					subset: glyph,
				},
			},
			callback: ({font}) => {
				localClient.dispatchAction('/store-value-font', {
					glyph: font.glyphs[0],
				});
			},
		});

		const fontPromise = _.chunk(_.uniq(subset.split('')), Math.ceil(subset.length / pool.workerArray.length))
			.map((subsubset) => {
				return new Promise((resolve) => {
					jobs.push({
						action: {
							type: 'constructGlyphs',
							data: {
								params,
								subset: subsubset,
							},
						},
						callback: (font) => {
							resolve(font);
						},
					});
				});
			});

		pool.doJobs(jobs);

		Promise.all(fontPromise).then((fonts) => {
			let fontResult;

			fonts.forEach(({font}) => {
				if (fontResult) {
					fontResult.glyphs = [
						...fontResult.glyphs,
						...font.glyphs,
					];
				}
				else {
					fontResult = font;
				}
			});

			const arrayBuffer = fontToSfntTable({
				...fontResult,
				fontFamily: {en: 'Prototypo web font'},
				fontSubfamily: {en: 'Regular'},
				postScriptName: {},
				unitsPerEm: 1024,
			});

			if (params.trigger) {
				 triggerDownload(arrayBuffer.buffer, 'hello');
			}

			const fontFace = new FontFace(
				'Prototypo web font',
				arrayBuffer.buffer,
			);

			if (oldFont) {
				document.fonts.delete(oldFont);
			}

			document.fonts.add(fontFace);
			oldFont = fontFace;

			localClient.dispatchAction('/store-value-font', {
				font: fontResult,
			});
		});
	},
};

var a = document.createElement('a');

var triggerDownload = function(arrayBuffer, filename ) {
	var reader = new FileReader();
	var enFamilyName = filename;

	reader.onloadend = function() {
		a.download = enFamilyName + '.otf';
		a.href = reader.result;
		a.dispatchEvent(new MouseEvent('click'));

		setTimeout(function() {
			a.href = '#';
			_URL.revokeObjectURL( reader.result );
		}, 100);
	};

	reader.readAsDataURL(new Blob(
		[ new DataView( arrayBuffer ) ],
		{ type: 'font/opentype' }
	));
};
