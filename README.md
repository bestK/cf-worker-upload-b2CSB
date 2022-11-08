# cf-worker-upload-b2CSB
Upload file to B2 Cloud Storage with cloud flare worker

# cf-worker-upload-b2CSB
Upload file to B2 Cloud Storage with cloud flare worker

1. create KV
wrangler kv:namespace create "<YOU_NAMESPACE>"  &&  wrangler kv:namespace create "YOU_NAMESPACE" --preview

2. sign up B2 Cloud Storage and create bucket and get your bucket api access key for upload
    
    https://secure.backblaze.com/user_signin.htm
3. code source from

    https://walshy.dev/blog/21_09_10-handling-file-uploads-with-cloudflare-workers
    
    https://blog.meow.page/archives/free-personal-image-hosting-with-backblaze-b2-and-cloudflare-workers/
