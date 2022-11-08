# cf-worker-upload-b2CSB
Upload file to B2 Cloud Storage with cloud flare worker

1. create KV
wrangler kv:namespace create "<YOU_NAMESPACE>"  &&  wrangler kv:namespace create "YOU_NAMESPACE" --preview

2. sign up B2 Cloud Storage and create bucket and get your bucket api access key for upload
    
    https://secure.backblaze.com/user_signin.htm
3. code source from

    https://walshy.dev/blog/21_09_10-handling-file-uploads-with-cloudflare-workers
    
    https://blog.meow.page/archives/free-personal-image-hosting-with-backblaze-b2-and-cloudflare-workers/



4. example
``` shell
curl --location --request POST 'https://up.example.com/upload' ^
--form 'file=@"/E:/Downloads/cherbim_2021-07-14_16-18-38.png"'


{
    "message": "Uploaded!",
    "file": "ec6cf100-4165-42b8-9fa2-55420e42764b.png",
    "downloadUrl": "https://up.example.com/ec6cf100-4165-42b8-9fa2-55420e42764b.png",
    "hash": "ab7c529fd372fa5ba465153a714d12999dc5c84d"
}
```
