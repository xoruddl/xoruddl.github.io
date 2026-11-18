---
layout: post
title: "TypeScript (4) - 리터럴, 유니온/교차 타입"
date: 2026-11-19 00:30:59 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "리터럴 타입", "유니온 타입", "교차 타입"]
---

## 값 자체가 타입이 되는 리터럴 타입

지금까지는 `string`, `number`처럼 "어떤 종류의 값인지"를 타입으로 썼다. TypeScript에서는 `"Bob"`, `3` 같은 **특정 값 하나**도 타입이 될 수 있다. 이를 **리터럴 타입**(literal type)이라고 한다.

`const`와 `let`으로 변수를 선언해 보면 차이가 드러난다.

```ts
const userName1 = "Bob";
let userName2: string | number = "Tom";
userName2 = 3;
```

`const`는 다시 값을 넣을 수 없으므로 `userName1`은 앞으로도 `"Bob"`일 수밖에 없다. 그래서 TypeScript는 `userName1`의 타입을 `string`이 아니라 `"Bob"`이라는 문자열 리터럴 타입으로 추론한다. 에디터에서 `userName1`에 마우스를 올려 보면 `const userName1: "Bob"`으로 표시된다.

`let`은 나중에 다른 값을 넣을 수 있으므로 타입을 넓게 잡는다. 타입을 적지 않았다면 `userName2`는 `string`으로 추론되고, 이때 `userName2 = 3`은 에러가 난다. 위 코드처럼 `string | number`로 선언해 두면 문자열과 숫자를 모두 넣을 수 있다. `|`의 뜻은 아래 유니온 타입에서 자세히 다룬다.

## 리터럴 타입으로 허용할 값 제한하기

리터럴 타입은 `|`로 묶어 "이 값들 중 하나만 허용한다"는 규칙을 만들 때 유용하다. 직업을 세 가지 중 하나로만 받고 싶다면 다음처럼 `type`으로 이름을 붙여 둔다.

```ts
type Job = "police" | "developer" | "teacher";

interface User {
    name: string;
    job: Job;
}

const user: User = {
    name: "Bob",
    job: "developer",
};
```

`type Job = ...`은 타입에 별명을 붙이는 **타입 별칭**(type alias)이다. `User`의 `job`은 `Job` 타입이므로 `"police"`, `"developer"`, `"teacher"` 중 하나만 들어갈 수 있다.

`job: "student"`처럼 목록에 없는 값을 넣으면 `"student"`는 `Job`에 할당할 수 없다는 에러가 난다. 또 `job` 대신 `grade: "developer"`처럼 `User`에 없는 속성 이름을 쓰면, `grade`는 정의되지 않은 속성이고 필수 속성 `job`이 빠졌다는 에러가 함께 난다. 문자열로만 받았다면 오타가 있어도 그대로 통과했을 값을 컴파일 단계에서 막아 주는 것이다.

숫자도 리터럴 타입으로 쓸 수 있다.

```ts
interface HighSchoolStudent {
    name: number | string;
    grade: 1 | 2 | 3;
}
```

고등학생의 학년은 1, 2, 3학년뿐이므로 `grade`를 `1 | 2 | 3`으로 제한했다. `grade: 4`를 넣으면 에러가 난다. `name`은 `number | string`이라 숫자와 문자열을 모두 받는다.

## 유니온 타입: 여러 타입 중 하나

`A | B`처럼 타입을 `|`로 이은 것을 **유니온 타입**(union type)이라고 한다. "A이거나 B"라는 뜻이다. 앞에서 본 `string | number`, `1 | 2 | 3`이 모두 유니온 타입이다.

객체 타입도 유니온으로 묶을 수 있다. 선물로 자동차나 휴대폰 중 하나를 받는 함수를 만들어 보자.

```ts
interface Car {
    name: "car";
    color: string;
    start(): void;
}

interface Mobile {
    name: "mobile";
    color: string;
    call(): void;
}

function getGift(gift: Car | Mobile) {
    console.log(gift.color);
    if (gift.name === "car") {
        gift.start();
    } else {
        gift.call();
    }
}
```

`gift`는 `Car`일 수도, `Mobile`일 수도 있다. 이때 사용할 수 있는 속성은 두 타입에 **공통으로 있는 것**뿐이다. `color`는 둘 다 가지고 있으므로 `gift.color`는 바로 쓸 수 있다.

반면 `start()`는 `Car`에만, `call()`은 `Mobile`에만 있다. 타입을 확인하지 않고 `gift.start()`를 부르면 `Mobile`에는 `start`가 없다는 에러가 난다.

## 식별 가능한 유니온

그렇다면 `gift`가 어느 쪽인지 어떻게 알아낼까? 위 코드에서 `Car`의 `name`은 `"car"`, `Mobile`의 `name`은 `"mobile"`이라는 리터럴 타입이다. 같은 이름의 속성이 타입마다 다른 리터럴 값을 가지므로, 이 값만 보면 어느 타입인지 구분할 수 있다.

```ts
if (gift.name === "car") {
    gift.start(); // 여기서 gift는 Car
} else {
    gift.call();  // 여기서 gift는 Mobile
}
```

`gift.name === "car"`가 참인 블록 안에서 TypeScript는 `gift`를 `Car`로 좁혀서 본다. 그래서 `start()`를 호출할 수 있다. `else` 블록에서는 남은 경우인 `Mobile`로 좁혀지므로 `call()`을 호출할 수 있다. 이렇게 조건문으로 타입 범위를 줄이는 것을 **타입 좁히기**(narrowing)라고 한다.

이처럼 공통 속성의 리터럴 값으로 구분할 수 있는 유니온 타입을 **식별 가능한 유니온**(discriminated union)이라고 한다. 구분에 쓰는 `name` 같은 속성을 판별자라고 부른다. 구분할 타입이 많아지면 `if` 대신 `switch (gift.name)`으로 나눠도 같은 방식으로 타입이 좁혀진다.

## 교차 타입: 여러 타입을 모두 만족

유니온 타입이 "A이거나 B"라면, `A & B`로 쓰는 **교차 타입**(intersection type)은 "A이면서 B"라는 뜻이다. 여러 타입을 하나로 합쳐, 모든 타입의 속성을 다 가진 타입을 만든다.

```ts
interface Car {
    name: string;
    start(): void;
}

interface Toy {
    name: string;
    color: string;
    price: number;
}

const toyCar: Toy & Car = {
    name: "타요",
    start() {},
    color: "blue",
    price: 1000,
};
```

`toyCar`는 장난감이면서 자동차다. 따라서 `Toy`의 `name`, `color`, `price`와 `Car`의 `start()`를 모두 가져야 한다. `name`은 두 타입에 모두 있지만 같은 `string`이므로 한 번만 적으면 된다.

이 중 하나라도 빠지면 에러가 난다. 예를 들어 `price`를 지우면 `Toy & Car`에 필요한 `price` 속성이 없다는 에러가 난다.

## 유니온과 교차 타입 비교

두 타입은 기호가 비슷해서 헷갈리기 쉽다. 값을 만드는 쪽과 쓰는 쪽에서 무엇이 달라지는지 비교하면 다음과 같다.

| 구분 | 유니온 타입 (`A \| B`) | 교차 타입 (`A & B`) |
| --- | --- | --- |
| 의미 | A **이거나** B | A **이면서** B |
| 값을 만들 때 | A나 B 중 하나의 모양만 갖추면 된다 | A와 B의 속성을 모두 갖춰야 한다 |
| 값을 쓸 때 | 공통 속성만 바로 쓸 수 있고, 나머지는 타입을 좁힌 뒤 쓴다 | A와 B의 모든 속성을 바로 쓸 수 있다 |
| 예시 | `getGift(gift: Car \| Mobile)` | `toyCar: Toy & Car` |

## 정리

리터럴 타입은 `"Bob"`, `3`처럼 특정 값 하나를 타입으로 쓰는 것이다. `const`로 선언한 변수는 리터럴 타입으로 추론되고, `"police" | "developer" | "teacher"`처럼 리터럴을 `|`로 묶으면 허용할 값을 몇 가지로 제한할 수 있다.

유니온 타입 `A | B`는 여러 타입 중 하나를 뜻한다. 공통 속성만 바로 쓸 수 있으므로, 각 타입에 `name: "car"`처럼 리터럴 판별자를 두고 조건문으로 타입을 좁혀 쓴다. 이것이 식별 가능한 유니온이다.

교차 타입 `A & B`는 여러 타입을 합쳐 모든 속성을 갖춘 타입을 만든다. 유니온은 "또는", 교차는 "그리고"로 기억하면 구분하기 쉽다.
