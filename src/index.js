/* 404to302 Lambda@Edge
 *
 * This lambda function is designed to be run on "Origin Response", and will
 * convert any 404 to a 302. The generated redirect will point to the location
 * found in the `FallbockLocation` tag of the CloudFront triggering this Lambda
 * In the specified location, following strings are replaced:
 *  - @@. : with a single `@`
 *  - @host@   : with the host-header from the request
 *  - @path@   : with the requested path. Note that the path always starts with a `/`
 *  - @query@  : with the query string (excluding the leading `?`)
 *
 * Note: @ is used, because $ and {} is not allowed in Tag Values:
 * https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions
 */

"use strict";

const AWS = require('aws-sdk');

/* Lambda@Edge has a 30 seconds timeout on Origin Response
 * Allow us to time out so we can see this in the Lambda metrics
 */
const timeout_ms = 45000;

function asyncCloudFrontGetTagsForResource(param, service_param = {}) {
    // Async wrapper around the CloudFront GetTagsForResource call
    return new Promise(function(resolve, reject) {
        const cloudfront = new AWS.CloudFront(service_param);
        cloudfront.listTagsForResource(param, function(err, data) {
            if(err !== null) { reject(err); }
            else { resolve(data); }
        });
    });
}

function getAccountId(context) {
    const lambdaArn = context.invokedFunctionArn;
    return lambdaArn.split(":")[4];
}

async function get_redirect_location_(account_id, cloudfront_id) {
    /* Read out the tags of the calling CloudFront distribution
     * Note: We are using the Account of this Lambda as being the account of the CloudFront.
     *       This is correct, since it's (currently) not possible to attach
     *       Lambda@Edge cross-account.
     */
    const cf_arn = `arn:aws:cloudfront::${account_id}:distribution/${cloudfront_id}`;
    const response = await asyncCloudFrontGetTagsForResource({"Resource": cf_arn});
    const tag_list = response['Tags']['Items'];
    const tags = tag_list.reduce(function(map, obj) {
        map[obj.Key] = obj.Value;
        return map;
    }, {});
    return tags["FallbackLocation"];
}
function get_redirect_location_promise(account_id, cf_id) {
    if(typeof get_redirect_location_promise.cache === 'undefined') {
        get_redirect_location_promise.cache = {};
    }
    if(!( cf_id in get_redirect_location_promise.cache )) {
        get_redirect_location_promise.cache[cf_id] = get_redirect_location_(account_id, cf_id);
    }
    return get_redirect_location_promise.cache[cf_id]
}

function replace_at_codes(input, replacements) {
    return input.replace(/@([a-z]*)@/g, function (match, p1) {
        if( p1 === "" ) return "@";
        if( replacements[p1] === undefined ) return "";
        return replacements[p1];
    });
}


async function attempt_redirect(request, request_config, response, hostname, context) {
    console.log("Response is a 404, processing...");

    const redirect_location = await get_redirect_location_promise(
        getAccountId(context),
        request_config.distributionId
    );
    if (redirect_location === undefined) {
        console.log("No location specified, passing through unmodified");
        return response;
    }
    console.log(`Found redirect location: ${redirect_location}`);

    const location = replace_at_codes(redirect_location, {
        "host": hostname,
        "path": request.uri,
        "query": request.querystring,
    });
    console.log(`Rendering 302 redirect to: ${location}`);

    response.status = "302";
    response.statusDescription = 'Found';

    /* Drop the body, as it is not required for redirects */
    response.body = '';
    response.headers['location'] = [{key: 'Location', value: location}];

    return response;
}

exports.handler = async (event, context) => {
    const request_config = event.Records[0].cf.config;
    console.log(`Handling ${request_config.eventType} for ${request_config.distributionId}: ` +
        `id=${request_config.requestId}`);  // requestId is not present on Origin-request

    const request = event.Records[0].cf.request;
    const request_headers = request.headers;
    const hostname = request_headers.host[0].value;  // Host:-header is required, should always be present;
    console.log(`${request.method} request for //${hostname}${request.uri}?${request.querystring}`);

    const response = event.Records[0].cf.response;

    if(response.status === "404") {
        let timeout_handle = null;
        const timeout_prom = new Promise(function(resolve, reject) {
            timeout_handle = setTimeout(() => reject('timeout'), timeout_ms);
        });
        const redir_prom = attempt_redirect(request, request_config, response, hostname, context);

        try {
            const redirect_response = await Promise.race([redir_prom, timeout_prom]);
            clearTimeout(timeout_handle);
            return redirect_response;
        } catch(error) {
            console.log("Timeout generating redirect, passing through the 404 anyway...");
            return response;
        }
    } else {
        console.log("Passing response through unmodified");
        return response;
    }
    // unreachable
};
