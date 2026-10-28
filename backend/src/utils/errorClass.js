class BadRequest extends Error{
    constructor(message){
        super(message);
        this.status = 400;
        this.name = "Bad Request Error"
    }
}

class Unauthorized extends Error{
    constructor(message){
        super(message);
        this.status = 401;
        this.name = "Unauthorized Error"
    }
}

class Forbidden extends Error{
    constructor(message){
        super(message);
        this.status = 403;
        this.name = "Forbidden Error"
    }
}

class NotFound extends Error{
    constructor(message){
        super(message);
        this.status = 404;
        this.name = "Not Found Error"
    }
}

class Conflict extends Error{
    constructor(message){
        super(message);
        this.status = 409;
        this.name = "Conflict Error"
    }
}

class InternalServer extends Error{
    constructor(message){
        super(message);
        this.status = 500;
        this.name = "Internal Server Error"
    }
}

export {
    BadRequest, Unauthorized, NotFound, Forbidden, Conflict, InternalServer
}
