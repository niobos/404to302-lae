const assert = require('assert');
const rewire = require('rewire');
const sinon = require('sinon');
const lae = rewire('../src/index.js');

function responseEvent(params) {
    if( params === undefined ) params = {};
    if( params.method === undefined ) params.method = "GET";
    if( params.host === undefined ) params.host = "www.example.org";
    if( params.uri === undefined ) params.uri = "/picture.jpg";
    if( params.query === undefined ) params.query = "size=lanrge";
    if( params.status === undefined ) params.status = 200;

    return {
        "Records": [
            {
                "cf": {
                    "config": {
                        "distributionDomainName": "d123.cloudfront.net",
                        "distributionId": "EDFDVBD6EXAMPLE",
                        "eventType": "viewer-response",
                        "requestId": "xGN7KWpVEmB9Dp7ctcVFQC4E-nrcOcEKS3QyAez--06dV7TEXAMPLE=="
                    },
                    "request": {
                        "clientIp": "2001:0db8:85a3:0:0:8a2e:0370:7334",
                        "method": params.method,
                        "uri": params.uri,
                        "querystring": params.query,
                        "headers": {
                            "host": [
                                {
                                    "key": "Host",
                                    "value": params.host
                                }
                            ],
                            "user-agent": [
                                {
                                    "key": "User-Agent",
                                    "value": "curl/7.18.1"
                                }
                            ]
                        }
                    },
                    "response": {
                        "status": params.status.toString(),
                        "statusDescription": "OK",
                        "headers": {
                            "server": [
                                {
                                    "key": "Server",
                                    "value": "MyCustomOrigin"
                                }
                            ],
                            "set-cookie": [
                                {
                                    "key": "Set-Cookie",
                                    "value": "theme=light"
                                },
                                {
                                    "key": "Set-Cookie",
                                    "value": "sessionToken=abc123; Expires=Wed, 09 Jun 2021 10:18:14 GMT"
                                }
                            ]
                        }
                    }
                }
            }
        ]
    }
}

function lambdaContext() {
    return {
        'invokedFunctionArn': 'arn:aws:lambda:eu-west-1:123456789012:function:lambda_name',
    };
}

describe("#getAccountId()", function() {
    it('should extract the accountId from the lambda ARN', function() {
        const account = lae.__get__('getAccountId')(lambdaContext());
        assert.strictEqual(account, "123456789012");
    });
});

describe("#replace_at_codes()", function() {
    const replace_at_codes = lae.__get__('replace_at_codes');

    const tests = [
        {input: "", replacements: {}, expected: ""},
        {input: "foo", replacements: {}, expected: "foo"},
        {input: "@foo", replacements: {}, expected: "@foo"},
        {input: "@@foo", replacements: {}, expected: "@foo"},
        {input: "@foo@", replacements: {foo: "bar"}, expected: "bar"},
        {input: "@foo@@foo@", replacements: {foo: "bar"}, expected: "barbar"},
        {input: "@foo@@bar@", replacements: {foo: "hello", bar: "world"}, expected: "helloworld"},
        {input: "@foo@ @bar@", replacements: {foo: "hello", bar: "world"}, expected: "hello world"},
        {input: "@unknown@", replacements: {foo: "hello", bar: "world"}, expected: ""},
    ];

    tests.forEach(function(test_item) {
        it(`should turn "${test_item.input}" into "${test_item.expected}"`, function() {
            const output = replace_at_codes(test_item.input, test_item.replacements);
            assert.strictEqual(output, test_item.expected);
        });
    });
});

describe('#get_redirect_location_promise()', function() {
    it('does the lookup', function() {
        const get_redir = async function (account, cf) {
            return `${account}/${cf}`;
        };
        return lae.__with__({
            'get_redirect_location_': get_redir,
        })(async function () {
            const account_id = '123456789012';
            const cf_id = "D12345";
            const location = await lae.__get__('get_redirect_location_promise')(account_id, cf_id);
            assert.strictEqual(location, `${account_id}/${cf_id}`);
        });
    });

    it('caches the result', function() {
        const get_redir = sinon.fake(async function (account, cf) {
            return `${account}/${cf}`;
        });
        return lae.__with__({
            'get_redirect_location_': get_redir,
        })(async function () {
            const account_id = '123456789012';
            const cf_id = "D7890";
            const location1 = await lae.__get__('get_redirect_location_promise')(account_id, cf_id);
            const location2 = await lae.__get__('get_redirect_location_promise')(account_id, cf_id);
            assert.strictEqual(location1, location2);
            assert.strictEqual(get_redir.callCount, 1);
        });
    });

    it('cache can be cleared', function() {
        const get_redir = sinon.fake(async function (account, cf) {
            return `${account}/${cf}`;
        });
        return lae.__with__({
            'get_redirect_location_': get_redir,
        })(async function () {
            const account_id = '123456789012';
            const cf_id = "Dfoobar";
            const location1 = await lae.__get__('get_redirect_location_promise')(account_id, cf_id);
            assert.strictEqual(get_redir.callCount, 1);

            lae.__get__('get_redirect_location_promise').cache = undefined;

            const location2 = await lae.__get__('get_redirect_location_promise')(account_id, cf_id);
            assert.strictEqual(get_redir.callCount, 2);
        });
    });
});

beforeEach(function() {
    lae.__get__('get_redirect_location_promise').cache = undefined;
});

it('should pass 200 responses through unmodified', async function() {
    const event = responseEvent();
    const response = await lae.handler(event, lambdaContext());
    assert.strictEqual(response, event.Records[0].cf.response);
});

it('should pass 201 responses through unmodified', async function() {
    const event = responseEvent({status: 201});
    const response = await lae.handler(event, lambdaContext());
    assert.strictEqual(response, event.Records[0].cf.response);
    assert.strictEqual(response.status, "201");
});

it('should pass 302 responses through unmodified', async function() {
    const event = responseEvent({status: 302});
    const response = await lae.handler(event, lambdaContext());
    assert.strictEqual(response, event.Records[0].cf.response);
});

it('should rewrite 404 responses', async function() {
    return lae.__with__({
        'get_redirect_location_': async function (context) {
            return 'https://target.example.org/';
        }
    })(async function () {
        const event = responseEvent({status: 404});
        const response = await lae.handler(event, lambdaContext());
        assert.strictEqual(response.status, "302");

        const location_headers = response.headers['location'];
        assert.strictEqual(location_headers.length, 1);

        const location = location_headers[0].value;
        assert.strictEqual(location, "https://target.example.org/");
    });
});

it('should not rewrite 404 responses when no location is given', async function() {
    return lae.__with__({
        'get_redirect_location_': async function (context) {
            return undefined;
        }
    })(async function () {
        const event = responseEvent({status: 404});
        const response = await lae.handler(event, lambdaContext());
        assert.strictEqual(response.status, "404");
    });
});

it('should substitute vars in location', async function() {
    return lae.__with__({
        'get_redirect_location_': async function (context) {
            return 'https://target2.example.org/@host@@path@';
        }
    })(async function () {
        const event = responseEvent({
            host: 'www.example.org',
            uri: '/foo/bar',
            query: 'key=value&otherkey=othervalue',
            status: 404,
        });
        const response = await lae.handler(event, lambdaContext());
        const location = response.headers['location'][0].value;
        assert.strictEqual(
            location,
            "https://target2.example.org/www.example.org/foo/bar"
        );
    });
});

it('should timeout rewriting a 404', async function() {
    return lae.__with__({
        'get_redirect_location_': async function (context) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return 'https://target.example.org/';
        }
    })(async function () {
        const event = responseEvent({status: 404});
        lae.__set__('timeout_ms', 100);
        const response = await lae.handler(event, lambdaContext());
        assert.strictEqual(response.status, "404");
    });
});