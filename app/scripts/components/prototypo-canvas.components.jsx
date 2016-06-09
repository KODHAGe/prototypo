import React from 'react';
import Classnames from 'classnames';
import LocalClient from '../stores/local-client.stores.jsx';
import Log from '../services/log.services.js';
import Lifespan from 'lifespan';

import {ContextualMenu, ContextualMenuItem} from './contextual-menu.components.jsx';
import CloseButton from './close-button.components.jsx';
import CanvasGlyphInput from './canvas-glyph-input.components.jsx';
import AlternateMenu from './alternate-menu.components.jsx';

export default class PrototypoCanvas extends React.Component {

	constructor(props) {
		super(props);

		this.state = {
			contextMenuPos: {x: 0, y: 0},
			showContextMenu: false,
		};
	}

	componentWillMount() {
		this.client = LocalClient.instance();
		this.lifespan = new Lifespan();
	}

	componentWillUnmount() {
		this.lifespan.release();
	}

	setupCanvas() {
		fontInstance.zoom = this.props.uiZoom ? this.props.uiZoom : 0.5;
		fontInstance.view.center = this.props.uiPos
			? this.props.uiPos instanceof prototypo.paper.Point
				? this.props.uiPos
				: new prototypo.paper.Point(this.props.uiPos[1], this.props.uiPos[2])
			: fontInstance.view.center;

		fontInstance.showNodes = this.props.uiNodes || false;
		fontInstance.showCoords = this.props.uiCoords || false;
		fontInstance.fill = !this.props.uiOutline;

		const canvasContainer = this.refs.canvas;

		if (canvasContainer.clientWidth
			&& canvasContainer.clientHeight
			&& (canvasContainer.clientWidth !== window.canvasElement.width
			|| canvasContainer.clientHeight !== window.canvasElement.height)) {

			const oldSize = new prototypo.paper.Size(window.canvasElement.width,
				window.canvasElement.height);

			if (oldSize.width && oldSize.height) {
				const center = fontInstance.view.center.clone();
				const glyphCenter = fontInstance.currGlyph.getPosition();

				const oldGlyphRelativePos = glyphCenter.subtract(center);
				const newSize = new prototypo.paper.Size(
					canvasContainer.clientWidth, canvasContainer.clientHeight);
				const ratio = newSize.divide(oldSize);

				const newDistance = new prototypo.paper.Point(oldGlyphRelativePos.x * ratio.width, oldGlyphRelativePos.y * ratio.height);
				const newCenterPos = glyphCenter.subtract(newDistance);

				this.client.dispatchAction('/store-value', {uiPos: newCenterPos});
			}

			window.canvasElement.width = canvasContainer.clientWidth;
			window.canvasElement.height = canvasContainer.clientHeight;
			fontInstance.view.viewSize = [canvasContainer.clientWidth, canvasContainer.clientHeight];
			fontInstance.view.update();
		}
	}

	componentDidUpdate() {
		this.setupCanvas();
	}

	mouseMove(e) {
		fontInstance.onMove.bind(fontInstance)(e);
	}

	wheel(e) {
		fontInstance.onWheel.bind(fontInstance)(e);
		this.client.dispatchAction('/store-value', {
			uiZoom: fontInstance.zoom,
			uiPos: fontInstance.view.center,
		});
	}

	mouseDown(e) {
		fontInstance.onDown.bind(fontInstance)(e);
	}

	mouseUp(e) {
		fontInstance.onUp.bind(fontInstance)(e);
		this.client.dispatchAction('/store-value', {
			uiPos: fontInstance.view.center,
			uiZoom: fontInstance.zoom,
		});
	}

	componentDidMount() {
		const canvasContainer = this.refs.canvas;

		canvasContainer.appendChild(window.canvasElement);
		canvasContainer.addEventListener('mousemove', (e) => { this.mouseMove(e); });
		canvasContainer.addEventListener('wheel', (e) => { this.wheel(e); });
		canvasContainer.addEventListener('mousedown', (e) => { this.mouseDown(e); });
		canvasContainer.addEventListener('mouseup', (e) => { this.mouseUp(e); });

		this.setupCanvas();
	}

	showContextMenu(e) {
		e.preventDefault();
		e.stopPropagation();
		this.setState({
			showContextMenu: true,
			contextMenuPos: {x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY},
		});

		Log.ui('PrototypoCanvas.showContextMenu');
	}

	hideContextMenu() {
		if (this.state.showContextMenu) {
			this.setState({
				showContextMenu: false,
			});
		}
	}

	reset() {
		this.props.reset({
			x: fontInstance.currGlyph.getBounds().center.x * window.devicePixelRatio,
			y: -fontInstance.currGlyph.getBounds().center.y * window.devicePixelRatio,
		});
	}

	handleZoomShortcut(e) {
		if (e.keyCode === 90 && !this.oldPos) {
			e.stopPropagation();
			this.oldPos = {
				uiPos: fontInstance.view.center,
				uiZoom: fontInstance.zoom,
				uiNodes: this.props.uiNodes,
				uiOutline: this.props.uiOutline,
			};
			this.client.dispatchAction('/store-value', {uiNodes: false, uiOutline: false});
			this.reset();
		}
	}


	finishZoomShortcut(e) {
		if (e.keyCode === 90) {
			e.stopPropagation();
			this.client.dispatchAction('/store-', this.oldPos);
			this.oldPos = undefined;
		}
	}

	acceptZoomShortcut() {
		this.handleZoomCb = (e) => {this.handleZoomShortcut(e)};
		this.finishZoomCb = (e) => {this.finishZoomShortcut(e)};
		window.addEventListener('keydown', this.handleZoomCb);
		window.addEventListener('keyup', this.finishZoomCb);
	}

	rejectZoomShortcut() {
		window.removeEventListener('keydown', this.handleZoomCb);
		window.removeEventListener('keyup', this.finishZoomCb);
		if (this.oldPos) {
			this.client.dispatchAction('/store-value', this.oldPos);
		}
	}

	render() {
		if (process.env.__SHOW_RENDER__) {
			console.log('[RENDER] PrototypoCanvas');
		}
		const canvasClass = Classnames({
			'is-hidden': this.props.uiMode.indexOf('glyph') === -1,
			'prototypo-canvas': true,
		});

		const menu = [
			<ContextualMenuItem
				key="nodes"
				text={`${fontInstance.showNodes ? 'Hide' : 'Show'} nodes`}
				click={() => { this.client.dispatchAction('/store-value', {uiNodes: !this.props.uiNodes}); }}/>,
			<ContextualMenuItem
				key="outline"
				text={`${fontInstance.fill ? 'Show' : 'Hide'} outline`}
				click={() => { this.client.dispatchAction('/store-value', {uiOutline: !this.props.uiOutline}); }}/>,
			<ContextualMenuItem
				key="coords"
				text={`${fontInstance.showCoords ? 'Hide' : 'Show'} coords`}
				click={() => { this.client.dispatchAction('/store-value', {coords: !this.props.uiCoords}); }}/>,
			<ContextualMenuItem
				key="reset"
				text="Reset view"
				click={() => { this.reset(); }}/>,
			<ContextualMenuItem
				key="shadow"
				text={`${this.props.uiShadow ? 'Hide' : 'Show'} shadow`}
				click={() => { this.client.dispatchAction('/store-value', {shadow: !this.props.uiShadow}); }}/>,
		];

		const alternateMenu = this.props && this.props.glyphs[this.props.glyphSelected].length > 1 ? (
			<AlternateMenu alternates={this.props.glyphs[this.props.glyphSelected]} unicode={this.props.glyphSelected}/>
		) : false;

		return (
			<div
				className={canvasClass}
				onContextMenu={(e) => { this.showContextMenu(e); }}
				onClick={() => { this.hideContextMenu(); }}
				onMouseLeave={() => { this.hideContextMenu(); }}>
				<div ref="canvas" className="prototypo-canvas-container" onMouseLeave={() => {this.rejectZoomShortcut()}} onMouseEnter={() => { this.acceptZoomShortcut();}} onDoubleClick={() => { this.reset(); }}></div>
				<div className="action-bar">
					<CloseButton click={() => { this.props.close('glyph'); }}/>
				</div>
				<ContextualMenu show={this.state.showContextMenu} pos={this.state.contextMenuPos}>
					{menu}
				</ContextualMenu>
				<div className="canvas-menu">
					<CanvasGlyphInput/>
					{alternateMenu}
				</div>
			</div>
		);
	}
}
