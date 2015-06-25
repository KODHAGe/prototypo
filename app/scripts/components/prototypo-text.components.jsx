import React from 'react';
import LocalClient from '../stores/local-client.stores.jsx';
import Lifespan from 'lifespan';

import {ContextualMenu, ContextualMenuItem} from './contextual-menu.components.jsx';

export default class PrototypoText extends React.Component {

	constructor(props) {
		super(props);

		this.state = {
			contextMenuPos:{x:0,y:0},
			showContextMenu:false,
		}
	}

	componentWillMount() {
		this.client = LocalClient.instance();
		this.lifespan = new Lifespan();

		this.client.fetch('/panel')
			.then((store) => {
				this.setState(store.head.toJS());
			});

		this.client.getStore('/panel',this.lifespan)
			.onUpdate(({head}) => {
				this.setState(head.toJS());
			})
			.onDelete(() => {
				this.setState(undefined);
			})
	}

	setupText() {
		const content = this.props.panel[this.props.field];
		React.findDOMNode(this.refs.text).textContent = content && content.length > 0 ? content : 'abcdefghijklmnopqrstuvwxyz\nABCDEFGHIJKLMNOPQRSTUVWXYZ\n,;.:-!?\‘\’\“\”\'\"\«\»()[]\n0123456789\n+&\/\náàâäéèêëíìîïóòôöúùûü\nÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜ\n\nᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀsᴛᴜᴠᴡʏᴢ';
	}

	componentDidUpdate() {
		this.setupText();
	}

	componentDidMount() {
		this.setupText();
	}

	componentWillUnmount() {
		this.saveText();
		this.lifespan.release();
	}

	saveText() {
		const textDiv = React.findDOMNode(this.refs.text);
		if (textDiv && textDiv.innerText) {
			this.client.dispatchAction('/store-text',{value:textDiv.innerText,propName:this.props.field});
		}
	}

	updateSubset() {
		const textDiv = React.findDOMNode(this.refs.text);
		if (textDiv && textDiv.value) {
			fontInstance.subset(textDiv.value);
		}
	}

	showContextMenu(e) {
		e.preventDefault();
		e.stopPropagation();
		this.setState({
			showContextMenu:true,
			contextMenuPos:{x:e.nativeEvent.offsetX,y:e.nativeEvent.offsetY},
		});
	}

	hideContextMenu() {
		if (this.state.showContextMenu) {
			this.setState({
				showContextMenu:false,
			});
		}
	}

	render() {
		const style = {
			'fontFamily':`${this.props.fontName || 'theyaintus'}, 'sans-serif'`,
			'fontSize': `${17 / this.props.panel.mode.length}rem`,
			'color': this.props.panel.invertedTextColors ? '#fefefe' : '#232323',
			'backgroundColor': !this.props.panel.invertedTextColors ? '#fefefe' : '#232323',
			'transform': this.props.panel.invertedTextView ? 'scaleY(-1)' : 'scaleY(1)',
		};

		const menu = [
			<ContextualMenuItem
				text="Toggle colors"
				key="view"
				click={() => { this.client.dispatchAction('/store-panel-param',{invertedTextColors:!this.props.panel.invertedTextColors}) }}/>,
		]

		return (
			<div
				className="prototypo-text"
				onContextMenu={(e) => { this.showContextMenu(e) }}
				onClick={() => { this.hideContextMenu() }}
				onMouseLeave={() => { this.hideContextMenu() }}>
				<div
					contentEditable="true"
					ref="text"
					className="prototypo-text-string"
					spellCheck="false"
					style={style}
					onInput={() => { this.updateSubset() }}
					onBlur={() => { this.saveText() }}
				></div>
				<ContextualMenu show={this.state.showContextMenu} pos={this.state.contextMenuPos}>
					{menu}
				</ContextualMenu>
			</div>
		)
	}
}
