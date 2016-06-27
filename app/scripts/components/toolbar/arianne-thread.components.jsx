import React from 'react';
import Lifespan from 'lifespan';
import PureRenderMixin from 'react-addons-pure-render-mixin';

import LocalClient from '~/stores/local-client.stores.jsx';

export default class ArianneThread extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			families: [],
			family: {},
			variant: {},
		};
		this.shouldComponentUpdate = PureRenderMixin.shouldComponentUpdate.bind(this);
	}

	async componentWillMount() {
		this.client = LocalClient.instance();
		this.lifespan = new Lifespan();
		const store = await this.client.fetch('/prototypoStore');

		this.client.getStore('/prototypoStore', this.lifespan)
			.onUpdate(({head}) => {
				this.setState({
					families: head.toJS().fonts,
					family: head.toJS().family,
					variant: head.toJS().variant,
				});
			})
			.onDelete(() => {
				this.setState(undefined);
			});

		this.setState({
			families: store.head.toJS().fonts,
			variant: store.head.toJS().variant,
			family: store.head.toJS().family,
		});
	}

	componentWillUnmount() {
		this.lifespan.release();
	}

	selectVariant(variant, family) {
		this.client.dispatchAction('/select-variant', {variant, family});
	}

	selectFamily(family) {
		this.client.dispatchAction('/select-variant', {variant: undefined, family});
	}

	addFamily() {
		this.client.dispatchAction('/open-create-family-modal', {});
	}

	addVariant() {
		this.client.dispatchAction('/open-create-variant-modal', {family: this.state.family});
	}

	showCollection() {
		this.client.dispatchAction('/store-value', {uiShowCollection: true});
	}

	render() {
		const variantFamily = _.find(this.state.families, (family) => {
			return family.name === this.state.family.name;
		});

		const variants = variantFamily
			? variantFamily.variants
			: [];

		const addFamily = <ArianneDropMenuItem item={{name: 'Add new family...'}} click={this.addFamily.bind(this)}/>
		const addVariant = <ArianneDropMenuItem item={{name: 'Add new variant...'}} click={this.addVariant.bind(this)}/>

		return (
			<div className="arianne-thread">
				<RootArianneItem click={this.showCollection.bind(this)}/>
				<DropArianneItem
					label={this.state.family.name}
					list={this.state.families}
					add={addFamily}
					click={this.selectFamily.bind(this)}/>
				<DropArianneItem
					label={this.state.variant.name}
					family={this.state.family}
					variant={this.state.variant}
					list={variants}
					add={addVariant}
					click={this.selectVariant.bind(this)}/>
				<ActionArianneItem label="group" img="assets/images/arianne-plus.svg"/>
			</div>
		);
	}
}

class RootArianneItem extends React.Component {
	constructor(props) {
		super(props);
		this.shouldComponentUpdate = PureRenderMixin.shouldComponentUpdate.bind(this);
	}

	render() {
		return (
			<div className="arianne-item is-small" onClick={this.props.click}>
				<div className="arianne-item-action is-small">
					<img className="arianne-item-action-collection" src="assets/images/collection.svg"/>
				</div>
				<div className="arianne-item-arrow"></div>
			</div>
		);
	}
}

class DropArianneItem extends React.Component {
	constructor(props) {
		super(props);
		this.shouldComponentUpdate = PureRenderMixin.shouldComponentUpdate.bind(this);
	}

	render() {
		return (
			<div className="arianne-item">
				<div className="arianne-item-action">
					{this.props.label}
					<img className="arianne-item-action-drop arianne-item-action-img" src="assets/images/drop.svg"/>
				</div>
				<div className="arianne-item-arrow"></div>
				<ArianneDropMenu
					list={this.props.list}
					click={this.props.click}
					family={this.props.family}
					add={this.props.add}
				/>
			</div>
		);
	}
}

class ArianneDropMenu extends React.Component {
	constructor(props) {
		super(props);
		this.shouldComponentUpdate = PureRenderMixin.shouldComponentUpdate.bind(this);
	}

	render() {
		const items = this.props.list.map((item) => {
			return <ArianneDropMenuItem item={item} key={item.name} click={this.props.click} family={this.props.family}/>;
		});

		return (
			<ul className="arianne-drop-menu">
				{items}
				{this.props.add}
			</ul>
		);
	}
}

class ArianneDropMenuItem extends React.Component {
	constructor(props) {
		super(props);
		this.shouldComponentUpdate = PureRenderMixin.shouldComponentUpdate.bind(this);
	}

	render() {
		return (
			<li className="arianne-drop-menu-item" onClick={() => {
				this.props.click(this.props.item, this.props.family);
			}}>
				{this.props.item.name}
			</li>
		);
	}
}

class ActionArianneItem extends React.Component {
	constructor(props) {
		super(props);
		this.shouldComponentUpdate = PureRenderMixin.shouldComponentUpdate.bind(this);
	}

	render() {
		return (
			<div className="arianne-item">
				<div className="arianne-item-action">
					{this.props.label}
					<img className="arianne-item-action-plus arianne-item-action-img" src={this.props.img}/>
				</div>
				<div className="arianne-item-arrow"></div>
			</div>
		);
	}
}