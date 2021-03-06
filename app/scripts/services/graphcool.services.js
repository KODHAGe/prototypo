import {ApolloClient, createBatchingNetworkInterface} from 'react-apollo';

import isProduction from '../helpers/is-production.helpers';

const networkInterface = createBatchingNetworkInterface({
	uri: `https://api.graph.cool/simple/v1/${isProduction() ? 'prototypo-prod' : 'prototypo-dev'}`,
	batchInterval: 10,
});

networkInterface.use([{
	applyBatchMiddleware(req, next) {
		if (!req.options.headers) {
			req.options.headers = {};
		}

		// get the authentication token from local storage if it exists
		if (localStorage.getItem('graphcoolToken')) {
			req.options.headers.authorization = `Bearer ${localStorage.getItem('graphcoolToken')}`;
		}
		next();
	},
}]);

const apolloClient = new ApolloClient({
	networkInterface,
	dataIdFromObject: o => o.id,
	connectToDevTools: true,
});

export default apolloClient;
